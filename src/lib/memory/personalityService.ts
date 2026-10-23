/**
 * Conversation-style profile + tone observations — the use-cases.
 *
 * Rules:
 *  - Everything here is covered by MEMORY consent (`isMemoryEnabled`). Nothing is
 *    stored, and nothing is injected, when memory is off. The live observe_tone
 *    tool may still ACT on a tone within the conversation; it just does not store it.
 *  - The profile is labelled inferred and built from words (transcripts), never
 *    from audio. The paid model analysis runs only when the caller says so
 *    (live conversations); demo conversations use the heuristic alone.
 *  - One conversation moves the profile by a bounded weight (EMA), so a single
 *    bad day never flips it.
 *  - Reset deletes the profile AND the tone events, and logs it; account deletion
 *    cascades through the foreign keys.
 */
import { analyzeStyleWithModel } from "@/lib/ai/personalityModel";
import { deletePersonalityProfile, getPersonalityProfile, upsertPersonalityProfile } from "@/lib/database/personality";
import { deleteToneEvents, insertToneEvent, listRecentToneEvents, listToneEventsForConversation, type InsertToneEventInput } from "@/lib/database/tone";
import { logWarn } from "@/lib/privacy/logging";
import type { ConversationMessage, PersonalityProfile, ToneEvent } from "@/lib/types";
import { analyzeStyleHeuristic, describeStyleForPrompt, MAX_MERGE_WEIGHT, mergeStyleProfile, MIN_MESSAGES_FOR_ANALYSIS } from "./personality";
import { logMemoryEvent } from "./repository";
import { isMemoryEnabled } from "./service";
import { describeFeel, toneDistribution, type ConversationFeel } from "./tone";

/** Tone events considered when recomputing the profile's tone/intent frequencies. */
export const TONE_WINDOW = 200;

export async function getStyleProfile(userId: string): Promise<PersonalityProfile | null> {
  return getPersonalityProfile(userId);
}

/** Prompt block for a new model session; "" when memory is off or there is not enough evidence. */
export async function buildStyleBlock(userId: string): Promise<string> {
  if (!(await isMemoryEnabled(userId))) return "";
  const profile = await getPersonalityProfile(userId);
  return profile ? describeStyleForPrompt(profile) : "";
}

/**
 * Weight of one conversation's observation: the spec'd confidence × 0.5, but
 * never less than the observation's share of all evidence so far (× 0.5), so a
 * young profile learns quickly and a mature one moves slowly. Capped at 0.5.
 */
export function observationWeight(confidence: number, newMessages: number, existingMessages: number): number {
  const byConfidence = confidence * 0.5;
  const byShare = existingMessages + newMessages > 0 ? (newMessages / (existingMessages + newMessages)) * 0.5 : 0.5;
  return Math.min(MAX_MERGE_WEIGHT, Math.max(byConfidence, byShare));
}

export async function updatePersonalityFromConversation(
  userId: string,
  conversationId: string,
  messages: ConversationMessage[],
  opts: { useModel: boolean },
): Promise<PersonalityProfile | null> {
  if (!(await isMemoryEnabled(userId))) return null;
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content).filter((c) => c.trim().length > 0);
  if (userMessages.length < MIN_MESSAGES_FOR_ANALYSIS) return null;

  const existing = await getPersonalityProfile(userId);
  const heuristic = analyzeStyleHeuristic(userMessages);
  let observation = heuristic.traits;
  let source: PersonalityProfile["source"] = "heuristic";
  let summary: string | undefined;

  if (opts.useModel) {
    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Companion"}: ${m.content.replace(/\s+/g, " ").trim()}`)
      .filter((line) => !/:\s*$/.test(line));
    const fromModel = await analyzeStyleWithModel(userId, conversationId, transcript, existing?.traits ?? null);
    if (fromModel) {
      observation = fromModel.traits;
      source = "model";
      if (fromModel.summary) summary = fromModel.summary;
    }
  }

  const weight = observationWeight(heuristic.confidence, userMessages.length, existing?.evidenceMessages ?? 0);
  const merged = mergeStyleProfile(existing?.traits ?? null, observation, weight);

  // Channels 2 and 3: tone / intent frequencies over the recent window.
  const recent = await listRecentToneEvents(userId, TONE_WINDOW);
  if (recent.length > 0) {
    const distribution = toneDistribution(recent);
    merged.tones = distribution.tones;
    merged.intents = distribution.intents;
  }

  const combinedSource: PersonalityProfile["source"] = existing && existing.source !== source ? "mixed" : source;
  const profile = await upsertPersonalityProfile(userId, {
    traits: merged,
    ...(summary !== undefined ? { summary } : {}),
    evidenceConversations: (existing?.evidenceConversations ?? 0) + 1,
    evidenceMessages: (existing?.evidenceMessages ?? 0) + userMessages.length,
    source: combinedSource,
  });
  await logMemoryEvent(userId, null, existing ? "corrected" : "created", {
    kind: "personality",
    conversationId,
    source,
    messages: userMessages.length,
    weight: Math.round(weight * 100) / 100,
  });
  return profile;
}

export async function resetPersonalityProfile(userId: string): Promise<{ deleted: boolean; toneEvents: number }> {
  const deleted = await deletePersonalityProfile(userId);
  const toneEvents = await deleteToneEvents(userId);
  await logMemoryEvent(userId, null, "deleted", { kind: "personality", profile: deleted, toneEvents });
  return { deleted, toneEvents };
}

/**
 * Stores one tone observation when memory is on; returns null (stores nothing)
 * when it is off. Callers that act on the tone in-conversation do so regardless.
 */
export async function recordToneObservation(userId: string, input: InsertToneEventInput): Promise<ToneEvent | null> {
  if (!(await isMemoryEnabled(userId))) return null;
  try {
    return await insertToneEvent(userId, input);
  } catch (error) {
    logWarn("tone_event_not_stored", { error: (error as Error).message });
    return null;
  }
}

/** Last `limit` tone events, newest first, without cues (cues are internal evidence). */
export async function listRecentTones(userId: string, limit = 20): Promise<Array<Pick<ToneEvent, "tone" | "intensity" | "intent" | "createdAt">>> {
  const events = await listRecentToneEvents(userId, limit);
  return events.map(({ tone, intensity, intent, createdAt }) => ({ tone, intensity, intent, createdAt }));
}

/** How one conversation felt, from its stored tone events; null when there are none. */
export async function describeConversationFeel(userId: string, conversationId: string): Promise<ConversationFeel | null> {
  const events = await listToneEventsForConversation(userId, conversationId);
  return describeFeel(events);
}
