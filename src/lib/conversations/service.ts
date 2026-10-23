/**
 * Conversation use-cases: start, record client telemetry, end (+ summarize).
 * Shared by the API routes and the integration tests. Ownership is enforced at
 * the repository layer (user-scoped queries); a foreign id simply reads as null.
 */
import { isUuid } from "@/lib/api/ids";
import type { z } from "zod";
import type { conversationEventSchema, createConversationSchema, EndConversationResponse } from "@/lib/api/contracts";
import { HttpError } from "@/lib/api/respond";
import { getModelId, getTranscriptionModelId, isLiveConfigured } from "@/lib/ai/models";
import { summarizeConversation, type SummaryCandidate } from "@/lib/ai/summarize";
import {
  addSpeechSeconds,
  appendMessage,
  createConversation,
  endConversation,
  getConversation,
  listMessages,
  setSummaryMemoryId,
} from "@/lib/database/conversations";
import { getMemory } from "@/lib/database/memories";
import { describeConversationFeel, updatePersonalityFromConversation } from "@/lib/memory/personalityService";
import { isMemoryEnabled, isSensitiveMemoryEnabled, getProfile } from "@/lib/memory/service";
import { heuristicSummary, storeCandidateMemory, storeSummaryMemory } from "@/lib/memory/summaries";
import { listTombstoneKeywords } from "@/lib/memory/tombstones";
import { logError, logWarn } from "@/lib/privacy/logging";
import type { Conversation, Memory, User } from "@/lib/types";
import { recordUsage } from "@/lib/usage/tracker";

export const DEMO_MODEL_ID = "demo-simulated";

export async function startConversation(user: User, input: z.infer<typeof createConversationSchema>): Promise<Conversation> {
  const mode = user.isDemo || !isLiveConfigured() ? "demo" : input.mode;
  if (input.mode === "live" && mode === "demo" && !user.isDemo) {
    throw new HttpError(409, "live_not_configured", "Live mode is not configured on this server (no OpenAI key). Demo mode is available.");
  }
  let continuedFromId: string | null = null;
  if (input.continueConversationId) {
    const previous = await getConversation(user.id, input.continueConversationId);
    if (!previous) throw new HttpError(404, "conversation_not_found", "That conversation could not be found.");
    continuedFromId = previous.id;
  }
  return createConversation({
    userId: user.id,
    mode,
    modelKey: input.modelKey,
    modelId: mode === "demo" ? DEMO_MODEL_ID : getModelId(input.modelKey),
    continuedFromId,
    metadata: mode === "demo" ? { simulated: true } : {},
  });
}

export async function requireOwnedConversation(userId: string, conversationId: string): Promise<Conversation> {
  if (!isUuid(conversationId)) throw new HttpError(404, "conversation_not_found", "That conversation could not be found.");
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) throw new HttpError(404, "conversation_not_found", "That conversation could not be found.");
  return conversation;
}

type ConversationEvent = z.infer<typeof conversationEventSchema>;

export async function recordConversationEvents(
  userId: string,
  conversationId: string,
  events: ConversationEvent[],
): Promise<{ received: number; stored: number }> {
  const conversation = await requireOwnedConversation(userId, conversationId);
  let stored = 0;
  for (const event of events) {
    switch (event.type) {
      case "message": {
        if (!event.content.trim()) break;
        await appendMessage({
          userId,
          conversationId,
          role: event.role,
          content: event.content,
          itemId: event.itemId ?? null,
          sources: event.sources ?? null,
        });
        stored += 1;
        break;
      }
      case "usage": {
        try {
          await recordUsage({
            userId,
            conversationId,
            modelId: conversation.modelId,
            kind: "realtime_response",
            inputTextTokens: event.inputTextTokens,
            inputAudioTokens: event.inputAudioTokens,
            cachedTextTokens: event.cachedTextTokens,
            cachedAudioTokens: event.cachedAudioTokens,
            outputTextTokens: event.outputTextTokens,
            outputAudioTokens: event.outputAudioTokens,
            metadata: event.responseId ? { responseId: event.responseId } : {},
          });
          stored += 1;
        } catch (error) {
          logError("usage_record_failed", error);
        }
        break;
      }
      case "speech": {
        await addSpeechSeconds(userId, conversationId, event.speaker, event.seconds);
        stored += 1;
        // Input transcription is billed per minute of the user's audio; the client
        // reports VAD-committed speech seconds. Demo conversations cost nothing.
        if (event.speaker === "user" && conversation.mode === "live" && event.seconds > 0) {
          try {
            await recordUsage({
              userId,
              conversationId,
              modelId: getTranscriptionModelId(),
              kind: "transcription",
              durationSeconds: event.seconds,
            });
          } catch (error) {
            logError("usage_record_failed", error);
          }
        }
        break;
      }
      case "connected": {
        await addSpeechSeconds(userId, conversationId, "connected", event.seconds);
        stored += 1;
        break;
      }
      case "client_error": {
        logWarn("client_error", { conversationId, code: event.code, message: event.message.slice(0, 200) });
        stored += 1;
        break;
      }
    }
  }
  return { received: events.length, stored };
}

/**
 * Ends a conversation and produces its summary. The paid AI summarizer runs ONLY
 * for a live conversation whose user has memory on (a demo conversation, or one
 * whose summary could not be stored anyway, never spends money); otherwise, or
 * when it fails, a heuristic summary (no API). The summary is stored as a
 * "summary" memory ONLY when memory is enabled, after filtering through
 * tombstones, labelled sensitive when it carries health / finances / grief /
 * family-conflict signals. Without sensitive consent the summarizer is told to
 * omit those details and the heuristic drops sensitive statements. Summarizer
 * candidates keep their own labels (reported / inferred); inferred ones are
 * returned as suggestions and never injected.
 * After the summary, the user's conversation-style profile is updated from
 * their words (heuristic always; the paid model only for a live conversation
 * with memory on) and the conversation's tone events are condensed into a
 * one-line "how it felt". Both are inferred, consent-gated and never block the end.
 * Idempotent: ending an ended conversation returns its stored summary.
 */
export async function finishConversation(userId: string, conversationId: string): Promise<EndConversationResponse> {
  const existing = await requireOwnedConversation(userId, conversationId);
  if (existing.status !== "active") {
    const summary = existing.summaryMemoryId ? await getMemory(userId, existing.summaryMemoryId) : null;
    return { conversation: existing, summary, suggestedMemories: [], styleUpdated: false };
  }

  let conversation = (await endConversation(userId, conversationId, "ended")) ?? existing;
  const messages = await listMessages(userId, conversationId);
  const [memoryOn, sensitiveOn, profile, tombstoneKeywords] = await Promise.all([
    isMemoryEnabled(userId),
    isSensitiveMemoryEnabled(userId),
    getProfile(userId),
    listTombstoneKeywords(userId),
  ]);

  let summaryText: string | null = null;
  let modelId: string | undefined;
  let candidates: SummaryCandidate[] = [];
  if (memoryOn && existing.mode === "live") {
    try {
      const result = await summarizeConversation(userId, conversationId, messages, {
        tombstoneKeywords,
        preferredName: profile.preferredName,
        allowSensitive: sensitiveOn,
      });
      if (result) {
        summaryText = result.summary;
        modelId = result.modelId;
        candidates = result.candidates;
      }
    } catch (error) {
      logError("summarize_failed", error);
    }
  }
  if (!summaryText) summaryText = heuristicSummary(messages, profile.preferredName, { allowSensitive: sensitiveOn });

  let summary: Memory | null = null;
  const suggestedMemories: Memory[] = [];
  if (memoryOn && summaryText) {
    summary = await storeSummaryMemory(userId, { content: summaryText, sourceConversationId: conversationId, modelId });
    if (summary) {
      await setSummaryMemoryId(userId, conversationId, summary.id);
      conversation = { ...conversation, summaryMemoryId: summary.id };
    }
  }
  if (memoryOn) {
    for (const candidate of candidates) {
      const stored = await storeCandidateMemory(userId, candidate, { sourceConversationId: conversationId, sensitiveAllowed: sensitiveOn });
      if (stored && stored.status === "inferred") suggestedMemories.push(stored);
    }
  }

  // Conversation-style profile (inferred from words, never audio) and "how it felt".
  let styleUpdated = false;
  let feel: EndConversationResponse["feel"];
  if (memoryOn) {
    try {
      const profile = await updatePersonalityFromConversation(userId, conversationId, messages, { useModel: existing.mode === "live" });
      styleUpdated = profile !== null;
    } catch (error) {
      logError("style_update_failed", error);
    }
    try {
      feel = (await describeConversationFeel(userId, conversationId)) ?? undefined;
    } catch (error) {
      logError("feel_failed", error);
    }
  }
  return { conversation, summary, suggestedMemories, styleUpdated, ...(feel ? { feel } : {}) };
}
