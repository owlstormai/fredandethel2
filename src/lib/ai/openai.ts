/**
 * The ONE place Companion talks to OpenAI over HTTP.
 *
 * - Uses global `fetch` so tests can stub it.
 * - Adds the bearer key server-side only. The key never leaves this module
 *   except as an Authorization header to api.openai.com.
 * - Throws HttpError(503, "live_unavailable") when no key is configured, so
 *   every caller degrades honestly instead of pretending to have called the API.
 * - Normalises upstream failures into HttpError without ever logging the key
 *   or response bodies (which may echo user content).
 *
 * Request/response shapes follow docs/API_VERIFICATION.md (sections 2, 3, 8, 9).
 */
import { HttpError } from "@/lib/api/respond";
import { isLiveConfigured } from "@/lib/ai/models";
import type { RealtimeSessionConfig } from "@/lib/ai/realtime/events";
import { logError, logWarn } from "@/lib/privacy/logging";

export const OPENAI_TIMEOUT_MS = 20_000;
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Browser-side SDP endpoint for WebRTC (no key inside; the ephemeral secret authenticates). */
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export function getOpenAIBaseUrl(): string {
  const raw = process.env.OPENAI_BASE_URL?.trim();
  return (raw && raw.length > 0 ? raw : DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

export interface OpenAIFetchInit extends Omit<RequestInit, "body"> {
  /** JSON-serialisable body. Strings/FormData are passed through untouched. */
  body?: unknown;
  /** Override the default 20s timeout. */
  timeoutMs?: number;
}

interface UpstreamErrorBody {
  error?: { message?: string; type?: string; code?: string | null; param?: string | null };
}

function combineSignals(timeoutMs: number, external?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, external]);
  return external;
}

/**
 * Fetch an OpenAI endpoint. `path` is relative to the v1 base ("/responses").
 * Resolves with the raw Response for 2xx; throws HttpError otherwise.
 */
export async function openaiFetch(path: string, init: OpenAIFetchInit = {}): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!isLiveConfigured() || !apiKey) {
    throw new HttpError(503, "live_unavailable", "Live AI features are not configured on this server.");
  }

  const { body, timeoutMs = OPENAI_TIMEOUT_MS, headers, signal, ...rest } = init;
  const url = `${getOpenAIBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const requestHeaders = new Headers(headers ?? {});
  requestHeaders.set("Authorization", `Bearer ${apiKey}`);
  let requestBody: BodyInit | undefined;
  if (body === undefined || body === null) {
    requestBody = undefined;
  } else if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
    requestBody = body;
  } else {
    requestBody = JSON.stringify(body);
    if (!requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
  }

  let response: Response;
  const started = Date.now();
  try {
    response = await fetch(url, {
      ...rest,
      method: rest.method ?? (requestBody === undefined ? "GET" : "POST"),
      headers: requestHeaders,
      body: requestBody,
      signal: combineSignals(timeoutMs, signal),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const timedOut = name === "TimeoutError" || (name === "AbortError" && Date.now() - started >= timeoutMs - 50);
    logWarn("openai_fetch_failed", { path, ms: Date.now() - started, reason: timedOut ? "timeout" : name ?? "network" });
    if (timedOut) throw new HttpError(504, "upstream_timeout", "The AI service took too long to respond.");
    if (name === "AbortError") throw new HttpError(499, "request_aborted", "The request was cancelled.");
    throw new HttpError(502, "upstream_unreachable", "Could not reach the AI service.");
  }

  if (response.ok) return response;

  // Error normalisation. We log status + machine-readable fields only; never the
  // message for 4xx (it can echo request content) and never the key.
  let parsed: UpstreamErrorBody | null = null;
  try {
    parsed = (await response.json()) as UpstreamErrorBody;
  } catch {
    parsed = null;
  }
  const upstream = parsed?.error ?? {};
  logError("openai_error", {
    path,
    status: response.status,
    type: upstream.type ?? null,
    code: upstream.code ?? null,
    param: upstream.param ?? null,
    ms: Date.now() - started,
  });

  switch (response.status) {
    case 401:
    case 403:
      throw new HttpError(503, "live_unavailable", "The server's AI credentials were rejected.");
    case 404:
      throw new HttpError(502, "upstream_not_found", "The AI service endpoint or model was not found.", {
        code: upstream.code ?? null,
      });
    case 429:
      throw new HttpError(503, "upstream_rate_limited", "The AI service is busy. Try again shortly.");
    case 400:
    case 422:
      throw new HttpError(502, "upstream_bad_request", "The AI service rejected the request.", {
        code: upstream.code ?? null,
        param: upstream.param ?? null,
      });
    default:
      throw new HttpError(502, "upstream_error", "The AI service returned an error.", { status: response.status });
  }
}

/** POST JSON, parse JSON. */
export async function openaiJson<T>(path: string, body: unknown, init: Omit<OpenAIFetchInit, "body"> = {}): Promise<T> {
  const response = await openaiFetch(path, { ...init, method: init.method ?? "POST", body });
  try {
    return (await response.json()) as T;
  } catch {
    logError("openai_bad_json", { path });
    throw new HttpError(502, "upstream_bad_response", "The AI service returned an unreadable response.");
  }
}

/** GET JSON. */
export async function openaiGet<T>(path: string, init: Omit<OpenAIFetchInit, "body" | "method"> = {}): Promise<T> {
  const response = await openaiFetch(path, { ...init, method: "GET" });
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(502, "upstream_bad_response", "The AI service returned an unreadable response.");
  }
}

// ---------------------------------------------------------------------------
// Realtime: ephemeral client secrets (API_VERIFICATION.md §2A)
// ---------------------------------------------------------------------------

export const CLIENT_SECRET_TTL_MIN_SECONDS = 10;
export const CLIENT_SECRET_TTL_MAX_SECONDS = 7200;

export interface ClientSecretResult {
  /** The ephemeral key ("ek_..."). The only secret the browser ever receives. */
  value: string;
  /** ISO timestamp of expiry (converted from epoch seconds). */
  expiresAt: string;
}

export interface CreateClientSecretOptions {
  /**
   * Opaque per-user identifier (hash, never the raw id/email). Sent as
   * `OpenAI-Safety-Identifier`; bound to the ephemeral token so the browser
   * never has to send it.
   */
  safetyIdentifier?: string;
}

interface ClientSecretResponseBody {
  value?: unknown;
  expires_at?: unknown;
  session?: unknown;
}

export async function createRealtimeClientSecret(
  session: RealtimeSessionConfig,
  ttlSeconds: number,
  options: CreateClientSecretOptions = {},
): Promise<ClientSecretResult> {
  const seconds = Math.min(
    CLIENT_SECRET_TTL_MAX_SECONDS,
    Math.max(CLIENT_SECRET_TTL_MIN_SECONDS, Math.round(Number.isFinite(ttlSeconds) ? ttlSeconds : 600)),
  );
  const headers: Record<string, string> = {};
  if (options.safetyIdentifier) headers["OpenAI-Safety-Identifier"] = options.safetyIdentifier;

  const data = await openaiJson<ClientSecretResponseBody>(
    "/realtime/client_secrets",
    { expires_after: { anchor: "created_at", seconds }, session },
    { headers },
  );

  if (typeof data.value !== "string" || data.value.length === 0) {
    logError("openai_client_secret_malformed", { hasValue: typeof data.value });
    throw new HttpError(502, "upstream_bad_response", "The AI service did not return a client secret.");
  }
  const expiresEpoch = typeof data.expires_at === "number" ? data.expires_at : Math.floor(Date.now() / 1000) + seconds;
  return { value: data.value, expiresAt: new Date(expiresEpoch * 1000).toISOString() };
}

// ---------------------------------------------------------------------------
// Responses API (API_VERIFICATION.md §8, §9)
// ---------------------------------------------------------------------------

export interface ResponsesUrlCitation {
  type: "url_citation";
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

export interface ResponsesOutputText {
  type: "output_text";
  text?: string;
  annotations?: Array<ResponsesUrlCitation | { type: string; [key: string]: unknown }>;
}

export type ResponsesOutputItem =
  | { type: "message"; id?: string; role?: string; status?: string; content?: Array<ResponsesOutputText | { type: string; [key: string]: unknown }> }
  | { type: "web_search_call"; id?: string; status?: string; action?: { type?: string; query?: string; [key: string]: unknown } }
  | { type: "reasoning"; id?: string; [key: string]: unknown }
  | { type: string; id?: string; [key: string]: unknown };

export interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponsesResponse {
  id?: string;
  model?: string;
  status?: string;
  output?: ResponsesOutputItem[];
  /** SDK convenience; the raw REST body may omit it. */
  output_text?: string;
  usage?: ResponsesUsage;
  error?: { code?: string; message?: string } | null;
}

export interface ResponsesCreateBody {
  model: string;
  input: string | Array<Record<string, unknown>>;
  instructions?: string;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: "auto" | "none" | "required" | Record<string, unknown>;
  reasoning?: { effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" };
  max_output_tokens?: number;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

export async function responsesCreate(body: ResponsesCreateBody): Promise<ResponsesResponse> {
  return openaiJson<ResponsesResponse>("/responses", body);
}

/** Concatenate all `output_text` parts of the message items (REST bodies lack `output_text`). */
export function extractOutputText(response: ResponsesResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    const content = (item as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
    }
  }
  if (parts.length === 0 && typeof response.output_text === "string") return response.output_text;
  return parts.join("\n").trim();
}

/** Map Responses usage to Companion's text-token fields (cached is a subset of input). */
export function responsesUsageToTokens(usage: ResponsesUsage | undefined): {
  inputTextTokens: number;
  cachedTextTokens: number;
  outputTextTokens: number;
} {
  const input = Math.max(0, Math.floor(usage?.input_tokens ?? 0));
  const cached = Math.min(input, Math.max(0, Math.floor(usage?.input_tokens_details?.cached_tokens ?? 0)));
  const output = Math.max(0, Math.floor(usage?.output_tokens ?? 0));
  return { inputTextTokens: input, cachedTextTokens: cached, outputTextTokens: output };
}
