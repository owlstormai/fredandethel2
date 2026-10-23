/**
 * Post-conversation summarization — SEAM FILE. Owner: AI/usage agent.
 * Called by the conversation `end` route. Returns null when no OPENAI_API_KEY
 * (caller falls back to a heuristic summary labeled "summarized").
 *
 * Implementation: Responses API with the cheap text model (API_VERIFICATION.md §9).
 * Structured-output parameters are not covered by the verification doc, so the
 * model is instructed to emit strict JSON and the reply is parsed defensively.
 * Candidates that match tombstoned (deleted) memories are dropped so a deleted
 * fact can never be re-suggested. Never throws to the caller.
 */
import { z } from "zod";
import { getTextModelId, isLiveConfigured } from "@/lib/ai/models";
import { extractOutputText, responsesCreate, responsesUsageToTokens } from "@/lib/ai/openai";
import { logInfo, logWarn } from "@/lib/privacy/logging";
import type { ConversationMessage, MemoryCategory, MemoryKind, MemorySensitivity } from "@/lib/types";
import { recordUsage } from "@/lib/usage/tracker";

export interface SummaryCandidate {
  content: string;
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  sensitivity: MemorySensitivity;
  /** "reported" if the user plainly stated it; "inferred" if a guess. */
  status: "reported" | "inferred";
}

export interface SummaryResult {
  summary: string;
  candidates: SummaryCandidate[];
  modelId: string;
}

export const MAX_TRANSCRIPT_CHARS = 6000;
export const MAX_CANDIDATES = 10;
export const TOMBSTONE_MIN_SHARED_KEYWORDS = 2;

const STOPWORDS = new Set([
  "that", "this", "with", "have", "from", "they", "their", "them", "there", "about", "would", "could",
  "should", "which", "what", "when", "where", "were", "been", "being", "will", "just", "like", "also",
  "into", "over", "than", "then", "some", "very", "really", "said", "says", "user", "companion", "your",
  "yours", "mine", "ours", "every", "because", "while", "after", "before", "much", "many", "more", "most",
  "does", "doing", "done", "want", "wants", "going", "thing", "things", "think", "know", "today",
]);

/** Lowercased content words (4+ letters, not stopwords). Same spirit as the memory service's tombstone keywords. */
export function keywordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

export function matchesTombstones(content: string, tombstoneKeywords: string[], minShared = TOMBSTONE_MIN_SHARED_KEYWORDS): boolean {
  if (tombstoneKeywords.length === 0) return false;
  const tomb = new Set(tombstoneKeywords.map((k) => k.toLowerCase()));
  const shared = keywordsOf(content).filter((k) => tomb.has(k));
  return shared.length >= minShared;
}

/** "User:/Companion:" lines, most recent first kept, capped by characters. */
export function buildTranscript(messages: ConversationMessage[], maxChars = MAX_TRANSCRIPT_CHARS): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = m.content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const line = `${m.role === "user" ? "User" : "Companion"}: ${text}`;
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.reverse().join("\n");
}

/** Added to the instructions when the user has NOT consented to sensitive memory. */
export const SENSITIVE_OMISSION_INSTRUCTION =
  "The user has not agreed to keep sensitive topics. Omit health, finances, grief and family-conflict details entirely — from the summary and from the candidates — even when they were the main point of the conversation; summarize only the rest.";

export function buildSummaryInstructions(preferredName: string | null, allowSensitive = true): string {
  const who = preferredName ? `The user is called ${preferredName}; refer to them by that name.` : "Refer to the user as \"the user\".";
  const sensitiveRule = allowSensitive
    ? "Leave out health, money, grief or family-conflict details unless they were the main point of the conversation."
    : SENSITIVE_OMISSION_INSTRUCTION;
  return [
    "You summarize a spoken conversation between an older adult and their AI voice companion for the companion's private notes.",
    who,
    "Respond with ONLY a JSON object, no prose, no code fences, matching exactly:",
    '{"summary": string, "candidates": [{"content": string, "kind": "fact"|"preference"|"interest"|"relationship"|"story", "category": "identity"|"family"|"friends"|"interest"|"routine"|"preference"|"story"|"health"|"finances"|"grief"|"other", "sensitivity": "normal"|"sensitive", "status": "reported"|"inferred"}]}',
    `summary: at most 3 sentences, third person, past tense, warm but factual. ${sensitiveRule}`,
    `candidates: up to ${MAX_CANDIDATES} things worth remembering for next time, each one plain sentence in third person. status is "reported" only if the user plainly said it in their own words; anything you deduced is "inferred". Mark health, finances, grief and family conflict as "sensitive". Do not include things the companion said about itself, small talk, or anything the user asked to forget.`,
    "If the transcript is empty or trivial, return an empty candidates array and a one-sentence summary.",
  ].join("\n");
}

const candidateSchema = z.object({
  content: z.string().trim().min(3).max(300),
  kind: z.enum(["fact", "preference", "interest", "relationship", "story"]).catch("fact"),
  category: z
    .enum(["identity", "family", "friends", "interest", "routine", "preference", "story", "health", "finances", "grief", "other"])
    .catch("other"),
  sensitivity: z.enum(["normal", "sensitive"]).catch("normal"),
  status: z.enum(["reported", "inferred"]).catch("inferred"),
});

const summaryPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  candidates: z.array(z.unknown()).catch([]),
});

/** Defensive JSON extraction: strips code fences and anything outside the outermost braces. */
export function parseSummaryJson(raw: string): { summary: string; candidates: SummaryCandidate[] } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const payload = summaryPayloadSchema.safeParse(parsed);
  if (!payload.success) return null;

  const candidates: SummaryCandidate[] = [];
  for (const item of payload.data.candidates) {
    const c = candidateSchema.safeParse(item);
    if (c.success) candidates.push(c.data);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  // Sensitive categories are always marked sensitive, whatever the model said.
  for (const c of candidates) {
    if (c.category === "health" || c.category === "finances" || c.category === "grief") c.sensitivity = "sensitive";
  }
  return { summary: payload.data.summary, candidates };
}

export async function summarizeConversation(
  userId: string,
  conversationId: string,
  messages: ConversationMessage[],
  options: { tombstoneKeywords: string[]; preferredName: string | null; allowSensitive?: boolean },
): Promise<SummaryResult | null> {
  if (!isLiveConfigured()) return null;

  const transcript = buildTranscript(messages);
  if (transcript.length === 0) return null;

  const modelId = getTextModelId();
  const started = Date.now();
  try {
    const response = await responsesCreate({
      model: modelId,
      instructions: buildSummaryInstructions(options.preferredName, options.allowSensitive ?? true),
      input: transcript,
      max_output_tokens: 900,
      ...(/^gpt-(5|6)/.test(modelId) ? { reasoning: { effort: "low" as const } } : {}),
    });

    const tokens = responsesUsageToTokens(response.usage);
    await recordUsage({
      userId,
      conversationId,
      modelId,
      kind: "summary",
      ...tokens,
      metadata: { transcriptChars: transcript.length },
    }).catch((error: unknown) => logWarn("summary_usage_not_recorded", { error: (error as Error).message }));

    const parsed = parseSummaryJson(extractOutputText(response));
    if (!parsed) {
      logWarn("summary_parse_failed", { ms: Date.now() - started });
      return null;
    }

    const before = parsed.candidates.length;
    const candidates = parsed.candidates.filter((c) => !matchesTombstones(c.content, options.tombstoneKeywords));
    logInfo("summary_created", { ms: Date.now() - started, candidates: candidates.length, suppressed: before - candidates.length });
    return { summary: parsed.summary, candidates, modelId };
  } catch (error) {
    logWarn("summary_failed", { ms: Date.now() - started, error: (error as Error).message });
    return null;
  }
}
