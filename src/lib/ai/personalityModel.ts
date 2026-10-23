/**
 * Model-assisted conversation-style analysis (live mode only).
 *
 * Same shape as summarize.ts: Responses API with the cheap text model, strict
 * JSON requested in the instructions, defensively parsed. The model reads the
 * TRANSCRIPT — words, not audio — so this is still an inference from what was
 * said and how it was phrased, never from the sound of the voice. The heuristic
 * result is handed over as a hint. The model is told to describe STYLE, not
 * facts, and to leave out health, finances, grief, family conflict and any
 * protected characteristic. Usage is recorded as kind "summary" with
 * metadata.purpose "style". Returns null without a key or on any failure; never throws.
 */
import { z } from "zod";
import { getTextModelId, isLiveConfigured } from "@/lib/ai/models";
import { extractOutputText, responsesCreate, responsesUsageToTokens } from "@/lib/ai/openai";
import { analyzeStyleHeuristic, coerceTraits, HUMOR_STYLES, MAX_NOTES, MAX_PHRASES, MAX_TOPICS, PACES, STYLE_TRAITS } from "@/lib/memory/personality";
import { classifySensitivity } from "@/lib/memory/sensitivity";
import { logInfo, logWarn } from "@/lib/privacy/logging";
import type { StyleProfileTraits } from "@/lib/types";
import { recordUsage } from "@/lib/usage/tracker";

export const MAX_STYLE_TRANSCRIPT_CHARS = 6000;

/** Sent verbatim in the instructions; tests assert its presence. */
export const STYLE_SENSITIVE_GUARD =
  "Describe STYLE, not facts. Never include anything about health, medication, finances, grief or loss, family conflict, religion, politics, ethnicity, disability, age or any other protected characteristic — not in topics, phrases, notes or the summary. Topics are hobbies and everyday subjects only.";

export function buildStyleInstructions(): string {
  return [
    "You study how an older adult talks in a spoken conversation with their AI voice companion, so the companion can match their conversational style.",
    "You read a transcript (their words only reach you as text); do not guess at tone of voice beyond what the words show.",
    "Respond with ONLY a JSON object, no prose, no code fences, matching exactly:",
    `{"scores": {${STYLE_TRAITS.map((t) => `"${t}": number`).join(", ")}}, "humorStyle": [${HUMOR_STYLES.map((s) => `"${s}"`).join("|")}], "topics": [string], "phrases": [string], "pace": ${PACES.map((p) => `"${p}"`).join("|")}, "notes": [string], "summary": string}`,
    "scores: each 0 to 1 — humor (how readily they joke), energy, formality, verbosity (length of their turns), warmth, curiosity (how much they ask), storytelling, directness.",
    `topics: up to ${MAX_TOPICS} favourite subjects, one or two words each. phrases: up to ${MAX_PHRASES} expressions they actually repeat. notes: up to ${MAX_NOTES} short observations about how they like to talk. summary: one plain paragraph, second person is fine ("You like..."), at most 60 words.`,
    STYLE_SENSITIVE_GUARD,
    "If a heuristic estimate is provided, treat it as a hint and correct it where the transcript disagrees.",
    "If the transcript is empty or trivial, return low confidence values: scores near 0.5, empty lists and a one-sentence summary saying there is not enough to go on.",
  ].join("\n");
}

const styleSchema = z.object({
  scores: z.record(z.string(), z.unknown()).catch({}),
  humorStyle: z.array(z.unknown()).catch([]),
  topics: z.array(z.unknown()).catch([]),
  phrases: z.array(z.unknown()).catch([]),
  pace: z.unknown(),
  notes: z.array(z.unknown()).catch([]),
  summary: z.string().trim().min(1).max(600),
});

/** Defensive JSON extraction; sensitive topics/notes are dropped whatever the model said. */
export function parseStyleJson(raw: string): { traits: StyleProfileTraits; summary: string } | null {
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
  const payload = styleSchema.safeParse(parsed);
  if (!payload.success) return null;
  const traits = coerceTraits({
    scores: payload.data.scores,
    humorStyle: payload.data.humorStyle,
    topics: payload.data.topics,
    phrases: payload.data.phrases,
    pace: payload.data.pace,
    notes: payload.data.notes,
  });
  traits.topics = traits.topics.filter((t) => classifySensitivity(t) === "normal");
  traits.notes = traits.notes.filter((n) => classifySensitivity(n) === "normal");
  traits.phrases = traits.phrases.filter((p) => classifySensitivity(p) === "normal");
  const summary = classifySensitivity(payload.data.summary) === "normal" ? payload.data.summary : "";
  return { traits, summary };
}

function capTranscript(lines: string[], maxChars = MAX_STYLE_TRANSCRIPT_CHARS): string {
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (total + line.length + 1 > maxChars) break;
    kept.push(line);
    total += line.length + 1;
  }
  return kept.reverse().join("\n");
}

export async function analyzeStyleWithModel(
  userId: string,
  conversationId: string,
  transcriptLines: string[],
  existing: StyleProfileTraits | null,
): Promise<{ traits: StyleProfileTraits; summary: string } | null> {
  if (!isLiveConfigured()) return null;
  const transcript = capTranscript(transcriptLines);
  if (transcript.length === 0) return null;

  const userLines = transcriptLines.filter((l) => /^User:/i.test(l)).map((l) => l.replace(/^User:\s*/i, ""));
  const hint = analyzeStyleHeuristic(userLines);
  const input = [
    "TRANSCRIPT:",
    transcript,
    "",
    `HEURISTIC ESTIMATE (hint only, from word counts; confidence ${hint.confidence}):`,
    JSON.stringify({ scores: hint.traits.scores, topics: hint.traits.topics, phrases: hint.traits.phrases }),
    ...(existing ? ["", "CURRENT PROFILE (from earlier conversations; refine, do not copy):", JSON.stringify({ scores: existing.scores, humorStyle: existing.humorStyle })] : []),
  ].join("\n");

  const modelId = getTextModelId();
  const started = Date.now();
  try {
    const response = await responsesCreate({
      model: modelId,
      instructions: buildStyleInstructions(),
      input,
      max_output_tokens: 700,
      ...(/^gpt-(5|6)/.test(modelId) ? { reasoning: { effort: "low" as const } } : {}),
    });
    const tokens = responsesUsageToTokens(response.usage);
    await recordUsage({
      userId,
      conversationId,
      modelId,
      kind: "summary",
      ...tokens,
      metadata: { purpose: "style", transcriptChars: transcript.length },
    }).catch((error: unknown) => logWarn("style_usage_not_recorded", { error: (error as Error).message }));

    const parsed = parseStyleJson(extractOutputText(response));
    if (!parsed) {
      logWarn("style_parse_failed", { ms: Date.now() - started });
      return null;
    }
    logInfo("style_analyzed", { ms: Date.now() - started });
    return parsed;
  } catch (error) {
    logWarn("style_analysis_failed", { ms: Date.now() - started, error: (error as Error).message });
    return null;
  }
}
