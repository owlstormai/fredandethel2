/**
 * Web search via the OpenAI Responses API `web_search` tool (API_VERIFICATION.md §8).
 *
 * Privacy rules enforced here, not left to the model:
 *  - requires `web_search` consent AND preferences.searchEnabled, else no API call;
 *  - the request input is the sanitized query ONLY (never memories or names);
 *  - the query is capped at 300 chars with newlines stripped;
 *  - cost (calls + text tokens) is recorded as a usage event.
 */
import { getSearchModelId, isLiveConfigured } from "@/lib/ai/models";
import {
  extractOutputText,
  responsesCreate,
  responsesUsageToTokens,
  type ResponsesCreateBody,
  type ResponsesResponse,
} from "@/lib/ai/openai";
import { HttpError } from "@/lib/api/respond";
import { getPreferences, hasConsent } from "@/lib/memory/service";
import { logInfo, logWarn } from "@/lib/privacy/logging";
import type { SearchSource } from "@/lib/types";
import { recordUsage } from "@/lib/usage/tracker";

export const MAX_SEARCH_QUERY_CHARS = 300;
export const MAX_SEARCH_SOURCES = 5;

export interface SearchWebOptions {
  reason?: string;
  /** IANA timezone for "today" context in the instructions. */
  timezone?: string | null;
  now?: Date;
}

export interface SearchWebResult {
  /** Spoken-style answer, or a sentence the model can relay when search was refused/unavailable. */
  answer: string;
  sources: SearchSource[];
  costUsd: number;
  searchCalls: number;
  /** True when no API call was made (consent/preferences/config/validation). */
  refused: boolean;
  reason?: "consent" | "disabled" | "unavailable" | "empty_query" | "query_too_long" | "upstream_error";
}

export function sanitizeQuery(raw: string): string {
  return raw
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function refusal(reason: NonNullable<SearchWebResult["reason"]>, answer: string): SearchWebResult {
  return { answer, sources: [], costUsd: 0, searchCalls: 0, refused: true, reason };
}

function formatDate(now: Date, timezone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone || "UTC" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(now);
  }
}

export function buildSearchInstructions(now: Date, timezone?: string | null): string {
  return [
    `Today is ${formatDate(now, timezone)}.`,
    "Answer in 2 to 4 short, spoken-style sentences for an older adult listening by voice.",
    "Say how recent the information is when it matters (for example \"as of this morning\").",
    "Use plain words for numbers, no lists, no markdown, no URLs in the text.",
    "Cite the sources you used; they are shown separately as links.",
    "If you cannot find a reliable answer, say so briefly instead of guessing.",
  ].join(" ");
}

function isUrlCitation(a: unknown): a is { type: "url_citation"; url?: string; title?: string } {
  return !!a && typeof a === "object" && (a as { type?: unknown }).type === "url_citation";
}

/** Pull answer text, deduped sources (max 5) and the number of search calls out of a Responses payload. */
export function parseSearchResponse(response: ResponsesResponse): { answer: string; sources: SearchSource[]; searchCalls: number } {
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  let searchCalls = 0;

  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") {
      searchCalls += 1;
      continue;
    }
    if (item.type !== "message") continue;
    const content = (item as { content?: Array<{ type: string; annotations?: unknown[] }> }).content ?? [];
    for (const part of content) {
      if (part.type !== "output_text") continue;
      for (const annotation of part.annotations ?? []) {
        if (!isUrlCitation(annotation) || typeof annotation.url !== "string") continue;
        let url: string;
        try {
          const parsed = new URL(annotation.url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
          url = parsed.toString();
        } catch {
          continue;
        }
        const key = url.replace(/\/+$/, "").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const title = (annotation.title ?? "").toString().trim() || new URL(url).hostname.replace(/^www\./, "");
        sources.push({ title: title.slice(0, 300), url: url.slice(0, 2000) });
      }
    }
  }

  const answer = cleanSpokenText(extractOutputText(response));
  return { answer, sources: sources.slice(0, MAX_SEARCH_SOURCES), searchCalls };
}

/** Strip markdown links / bare URLs / citation brackets so the text is safe to speak. */
export function cleanSpokenText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)\s]+\)/g, "$1")
    .replace(/\(?\bhttps?:\/\/[^\s)]+\)?/g, "")
    .replace(/\s*\[\d+\]/g, "")
    .replace(/[*_#`>]+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;!?])/g, "$1")
    .trim();
}

export async function searchWeb(
  userId: string,
  conversationId: string,
  rawQuery: string,
  opts: SearchWebOptions = {},
): Promise<SearchWebResult> {
  const query = sanitizeQuery(rawQuery ?? "");
  if (query.length === 0) {
    return refusal("empty_query", "No question was given to look up. Ask the user what they would like to know.");
  }
  if (query.length > MAX_SEARCH_QUERY_CHARS) {
    return refusal("query_too_long", "That search question is too long. Ask it again in one short sentence.");
  }

  const [consented, preferences] = await Promise.all([hasConsent(userId, "web_search"), getPreferences(userId)]);
  if (!consented || !preferences.searchEnabled) {
    return refusal(
      consented ? "disabled" : "consent",
      "Web search is turned off for this user. Tell them you cannot look things up right now, and offer to talk about it anyway.",
    );
  }
  if (!isLiveConfigured()) {
    return refusal("unavailable", "Web search is not available on this server right now. Say so plainly and offer to talk about it anyway.");
  }

  const modelId = getSearchModelId();
  const now = opts.now ?? new Date();
  const body: ResponsesCreateBody = {
    model: modelId,
    instructions: buildSearchInstructions(now, opts.timezone),
    input: query,
    tools: [{ type: "web_search", search_context_size: "low" }],
    tool_choice: "auto",
  };
  // Reasoning models (gpt-5.x/6.x) accept reasoning.effort; "low" keeps lookups cheap and fast.
  if (/^gpt-(5|6)/.test(modelId)) body.reasoning = { effort: "low" };
  if (opts.timezone) {
    body.tools = [{ type: "web_search", search_context_size: "low", user_location: { type: "approximate", timezone: opts.timezone } }];
  }

  const started = Date.now();
  let response: ResponsesResponse;
  try {
    response = await responsesCreate(body);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "unknown";
    logWarn("web_search_failed", { code, ms: Date.now() - started });
    return refusal("upstream_error", "The search service could not be reached just now. Say so plainly and offer to try again later.");
  }

  const parsed = parseSearchResponse(response);
  const tokens = responsesUsageToTokens(response.usage);

  let costUsd = 0;
  try {
    const recorded = await recordUsage({
      userId,
      conversationId,
      modelId,
      kind: "web_search",
      searchCalls: parsed.searchCalls,
      ...tokens,
      metadata: { sources: parsed.sources.length, queryChars: query.length, reason: opts.reason ? "given" : "none" },
    });
    costUsd = recorded.estimatedCostUsd;
  } catch (error) {
    logWarn("web_search_usage_not_recorded", { error: (error as Error).message });
  }

  logInfo("web_search", { searchCalls: parsed.searchCalls, sources: parsed.sources.length, ms: Date.now() - started, costUsd });

  const answer =
    parsed.answer.length > 0
      ? parsed.answer
      : "The search did not return a clear answer. Tell the user you could not find that just now.";
  return { answer, sources: parsed.sources, costUsd, searchCalls: parsed.searchCalls, refused: false };
}
