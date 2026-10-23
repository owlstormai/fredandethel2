import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeClientSecret, extractOutputText, openaiFetch, responsesUsageToTokens } from "@/lib/ai/openai";
import { HttpError } from "@/lib/api/respond";
import { buildRealtimeSessionConfig } from "@/lib/ai/realtime/sessionConfig";

const KEY = "sk-test-0123456789abcdef0123456789";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("openai wrapper", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("throws live_unavailable without a configured key and never calls fetch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(openaiFetch("/models")).rejects.toMatchObject({ status: 503, code: "live_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createRealtimeClientSecret posts the documented body with expires_after and session.type realtime", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: "ek_abc123", expires_at: 1_900_000_000, session: { type: "realtime" } }));

    const session = buildRealtimeSessionConfig({
      modelId: "gpt-realtime-2.1",
      voice: "marin",
      instructions: "hi",
      pauseSensitivity: "patient",
      tools: [],
      transcriptionModel: "gpt-realtime-whisper",
      vadMode: "semantic",
    });
    const result = await createRealtimeClientSecret(session, 600, { safetyIdentifier: "hash-123" });

    expect(result.value).toBe("ek_abc123");
    expect(result.expiresAt).toBe(new Date(1_900_000_000 * 1000).toISOString());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("OpenAI-Safety-Identifier")).toBe("hash-123");
    expect(headers.has("OpenAI-Beta")).toBe(false);

    const body = JSON.parse(init?.body as string);
    expect(body.expires_after).toEqual({ anchor: "created_at", seconds: 600 });
    expect(body.session.type).toBe("realtime");
    expect(body.session.model).toBe("gpt-realtime-2.1");
    expect(body.session.audio.output.voice).toBe("marin");
    expect(body.session.audio.input.turn_detection.type).toBe("semantic_vad");
  });

  it("clamps the TTL into the documented 10..7200 range", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockImplementation(async () => jsonResponse({ value: "ek_x", expires_at: 1 }));
    await createRealtimeClientSecret({ type: "realtime" }, 1);
    await createRealtimeClientSecret({ type: "realtime" }, 999_999);
    const seconds = fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body as string).expires_after.seconds);
    expect(seconds).toEqual([10, 7200]);
  });

  it("rejects a malformed secret response", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(jsonResponse({ nope: true }));
    await expect(createRealtimeClientSecret({ type: "realtime" }, 60)).rejects.toMatchObject({ code: "upstream_bad_response" });
  });

  it("normalises upstream errors without leaking the key", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: `bad key ${KEY}`, type: "invalid_request_error", code: "invalid_api_key" } }, 401));
    const err = await openaiFetch("/models").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect((err as HttpError).code).toBe("live_unavailable");
    expect(JSON.stringify(err)).not.toContain(KEY);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "slow down" } }, 429));
    await expect(openaiFetch("/models")).rejects.toMatchObject({ code: "upstream_rate_limited" });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "bad", param: "tools" } }, 400));
    await expect(openaiFetch("/responses", { body: {} })).rejects.toMatchObject({ code: "upstream_bad_request", details: { param: "tools", code: null } });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(openaiFetch("/models")).rejects.toMatchObject({ code: "upstream_unreachable" });
  });

  it("maps a timeout abort to upstream_timeout", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("timeout", "TimeoutError")));
      });
    });
    await expect(openaiFetch("/models", { timeoutMs: 5 })).rejects.toMatchObject({ code: "upstream_timeout" });
  });

  it("extracts output text and maps usage with cached as a subset of input", () => {
    const text = extractOutputText({
      output: [
        { type: "reasoning", id: "r" },
        { type: "message", content: [{ type: "output_text", text: "Hello" }, { type: "output_text", text: "there" }] },
      ],
    });
    expect(text).toBe("Hello\nthere");
    expect(responsesUsageToTokens({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 150 } })).toEqual({
      inputTextTokens: 100,
      cachedTextTokens: 100,
      outputTextTokens: 20,
    });
    expect(responsesUsageToTokens(undefined)).toEqual({ inputTextTokens: 0, cachedTextTokens: 0, outputTextTokens: 0 });
  });
});
