/**
 * POST /api/realtime/session — mint an ephemeral Realtime client secret for
 * the signed-in (non-demo) user and open a conversation record.
 *
 * This route's response carries ONLY: the ephemeral secret, its expiry, the
 * model/voice labels, the public SDP endpoint and counts about injected
 * context. The API key never leaves the server. Note that the instructions and
 * tool list are part of the session config bound to the ephemeral secret, and
 * OpenAI echoes the effective session (including instructions, i.e. the user's
 * OWN memory block) to the browser in `session.created`/`session.updated` over
 * the data channel; the holder of the secret can also `session.update` them.
 * That is inherent to the browser-WebRTC flow (API_VERIFICATION.md §2, §3) and
 * exposes nothing of other users; treat the prompt text as non-secret.
 */
import { createHash } from "node:crypto";
import { buildInstructions, estimateTokens } from "@/lib/ai/instructions";
import { resolveModelConfig } from "@/lib/ai/modelConfigs";
import { COMPANION_VOICES, EPHEMERAL_KEY_TTL_SECONDS, getTranscriptionModelId, isLiveConfigured } from "@/lib/ai/models";
import { REALTIME_CALLS_URL, createRealtimeClientSecret } from "@/lib/ai/openai";
import { buildRealtimeSessionConfig } from "@/lib/ai/realtime/sessionConfig";
import { companionToolDefinitions } from "@/lib/ai/tools/definitions";
import { realtimeSessionRequestSchema, type RealtimeSessionResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { createConversation, getConversation } from "@/lib/database/conversations";
import { buildStyleBlock } from "@/lib/memory/personalityService";
import { buildMemoryContext, getPreferences, getProfile, hasConsent } from "@/lib/memory/service";
import { logInfo, logWarn } from "@/lib/privacy/logging";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";
import { getMaxSessionSeconds } from "@/lib/usage/caps";
import { checkCaps, recordUsage } from "@/lib/usage/tracker";

const MEMORY_CONTEXT_MAX_TOKENS = 1200;

/** Opaque, stable per-user identifier for OpenAI-Safety-Identifier (never the raw id). */
function safetyIdentifier(userId: string): string {
  const salt = process.env.AUTH_SECRET ?? "companion";
  return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 32);
}

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("default", user.id);
  if (limited) return limited;
  if (user.isDemo) {
    throw new HttpError(403, "demo_user", "Demo profiles use the simulated companion and cannot start live sessions.");
  }
  if (!isLiveConfigured()) {
    throw new HttpError(403, "live_unavailable", "Live mode is not configured on this server (no OpenAI API key).");
  }

  const body = await parseBody(request, realtimeSessionRequestSchema);

  const cap = await checkCaps(user.id);
  if (!cap.allowed) throw new HttpError(403, "cap_reached", cap.detail, { reason: cap.reason });

  if (body.continueConversationId) {
    const previous = await getConversation(user.id, body.continueConversationId);
    if (!previous) throw new HttpError(404, "conversation_not_found", "The conversation to continue was not found.");
  }

  const modelConfig = await resolveModelConfig(body.modelKey);
  if (!modelConfig.enabled) {
    throw new HttpError(403, "model_disabled", `The ${modelConfig.label} model is disabled by configuration.`);
  }

  const [preferences, profile] = await Promise.all([getPreferences(user.id), getProfile(user.id)]);
  const searchEnabled = preferences.searchEnabled && (await hasConsent(user.id, "web_search"));
  const memory = await buildMemoryContext(user.id, {
    maxTokens: MEMORY_CONTEXT_MAX_TOKENS,
    continueConversationId: body.continueConversationId,
  });
  // Inferred conversation-style profile (from words, never audio); covered by memory consent.
  const styleBlock = preferences.memoryEnabled ? await buildStyleBlock(user.id) : "";

  const voice = COMPANION_VOICES[profile.companionVoice];
  const instructions = buildInstructions({
    companionVoice: profile.companionVoice,
    preferredName: profile.preferredName,
    humorLevel: preferences.humorLevel,
    onboardingStage: profile.onboardingStage,
    memoryEnabled: preferences.memoryEnabled,
    sensitiveMemoryEnabled: preferences.sensitiveMemoryEnabled,
    searchEnabled,
    memoryBlock: memory.block, // service applies consent gating; transcript continuation is always included
    styleBlock,
    mode: "live",
    now: new Date(),
    timezone: profile.timezone,
  });
  const tools = companionToolDefinitions({ searchEnabled });
  const sessionConfig = buildRealtimeSessionConfig({
    modelId: modelConfig.modelId,
    voice: voice.openaiVoice,
    instructions,
    pauseSensitivity: preferences.pauseSensitivity,
    tools,
    transcriptionModel: getTranscriptionModelId(),
  });

  const secret = await createRealtimeClientSecret(sessionConfig, EPHEMERAL_KEY_TTL_SECONDS, {
    safetyIdentifier: safetyIdentifier(user.id),
  });

  const conversation = await createConversation({
    userId: user.id,
    mode: "live",
    modelKey: modelConfig.key,
    modelId: modelConfig.modelId,
    continuedFromId: body.continueConversationId ?? null,
    metadata: {
      injectedMemoryIds: memory.memoryIds,
      injectedSummaryIds: memory.summaryIds,
      estimatedTokens: memory.estimatedTokens,
      instructionsTokens: estimateTokens(instructions),
      styleTokens: estimateTokens(styleBlock),
      voice: voice.openaiVoice,
      companionVoice: profile.companionVoice,
      humorLevel: preferences.humorLevel,
      pauseSensitivity: preferences.pauseSensitivity,
      searchEnabled,
      toolCount: tools.length,
    },
  });

  await recordUsage({
    userId: user.id,
    conversationId: conversation.id,
    modelId: modelConfig.modelId,
    kind: "session",
    metadata: { modelKey: modelConfig.key, continued: Boolean(body.continueConversationId) },
  }).catch((error: unknown) => logWarn("session_usage_not_recorded", { error: (error as Error).message }));

  logInfo("realtime_session_minted", {
    modelKey: modelConfig.key,
    memoryCount: memory.memoryIds.length,
    summaryCount: memory.summaryIds.length,
    continued: Boolean(body.continueConversationId),
  });

  const response: RealtimeSessionResponse = {
    mode: "live",
    conversationId: conversation.id,
    clientSecret: secret.value,
    expiresAt: secret.expiresAt,
    model: { key: modelConfig.key, id: modelConfig.modelId },
    voice: { label: voice.label, id: voice.openaiVoice },
    callsUrl: REALTIME_CALLS_URL,
    context: {
      estimatedTokens: memory.estimatedTokens,
      memoryCount: memory.memoryIds.length,
      summaryCount: memory.summaryIds.length,
    },
    maxSessionSeconds: getMaxSessionSeconds(),
  };
  return jsonOk(response);
});
