import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Preferences } from "@/lib/types";

vi.mock("@/lib/memory/service", () => ({
  hasConsent: vi.fn(),
  getPreferences: vi.fn(),
}));
vi.mock("@/lib/usage/tracker", () => ({
  recordUsage: vi.fn(),
}));

import { cleanSpokenText, parseSearchResponse, sanitizeQuery, searchWeb } from "@/lib/ai/tools/search";
import { getPreferences, hasConsent } from "@/lib/memory/service";
import { recordUsage } from "@/lib/usage/tracker";

const KEY = "sk-test-0123456789abcdef0123456789";
const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const prefs = (searchEnabled: boolean) => ({ searchEnabled } as Preferences);

/** Realistic Responses payload: a web_search_call item, then a message with url_citation annotations. */
const realisticPayload = {
  id: "resp_123",
  model: "gpt-6-luna",
  status: "completed",
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "Columbus Ohio weather today" } },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "As of this morning, Columbus is sunny with a high near sixty-two degrees. ([NWS](https://www.weather.gov/iln/)) Light winds are expected this afternoon. [1]",
          annotations: [
            { type: "url_citation", start_index: 60, end_index: 95, url: "https://www.weather.gov/iln/", title: "National Weather Service" },
            { type: "url_citation", start_index: 60, end_index: 95, url: "https://www.weather.gov/iln", title: "NWS duplicate" },
            { type: "url_citation", start_index: 100, end_index: 130, url: "https://example.com/forecast", title: "" },
            { type: "file_citation", file_id: "f" },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 1280 },
};

describe("search helpers", () => {
  it("sanitizes newlines and whitespace", () => {
    expect(sanitizeQuery("  weather\r\n in\tColumbus   today ")).toBe("weather in Columbus today");
  });

  it("cleans markdown links, URLs and bracket citations for speech", () => {
    expect(cleanSpokenText("Sunny ([NWS](https://w.gov/x)) today. [1] See https://e.com/f for more.")).toBe("Sunny (NWS) today. See for more.");
  });

  it("parses message text, counts search calls and dedupes sources (max 5)", () => {
    const parsed = parseSearchResponse(realisticPayload);
    expect(parsed.searchCalls).toBe(1);
    expect(parsed.answer).toContain("Columbus is sunny");
    expect(parsed.answer).not.toContain("http");
    expect(parsed.sources).toEqual([
      { title: "National Weather Service", url: "https://www.weather.gov/iln/" },
      { title: "example.com", url: "https://example.com/forecast" },
    ]);
    const many = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "x",
              annotations: Array.from({ length: 8 }, (_, i) => ({ type: "url_citation", url: `https://s${i}.example/`, title: `S${i}` })),
            },
          ],
        },
      ],
    };
    expect(parseSearchResponse(many).sources).toHaveLength(5);
  });
});

describe("searchWeb", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENAI_API_KEY", KEY);
    vi.mocked(recordUsage).mockResolvedValue({ estimatedCostUsd: 0.0101 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses without consent and never calls fetch", async () => {
    vi.mocked(hasConsent).mockResolvedValue(false);
    vi.mocked(getPreferences).mockResolvedValue(prefs(true));
    const result = await searchWeb(userId, conversationId, "news today");
    expect(result.refused).toBe(true);
    expect(result.reason).toBe("consent");
    expect(result.costUsd).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("refuses when the preference is off even with consent", async () => {
    vi.mocked(hasConsent).mockResolvedValue(true);
    vi.mocked(getPreferences).mockResolvedValue(prefs(false));
    const result = await searchWeb(userId, conversationId, "news today");
    expect(result).toMatchObject({ refused: true, reason: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty and over-long queries before any lookup", async () => {
    expect(await searchWeb(userId, conversationId, "   \n ")).toMatchObject({ refused: true, reason: "empty_query" });
    expect(await searchWeb(userId, conversationId, "a".repeat(301))).toMatchObject({ refused: true, reason: "query_too_long" });
    expect(hasConsent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades honestly when no API key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(hasConsent).mockResolvedValue(true);
    vi.mocked(getPreferences).mockResolvedValue(prefs(true));
    expect(await searchWeb(userId, conversationId, "news")).toMatchObject({ refused: true, reason: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Responses API with the documented tool shape and records usage", async () => {
    vi.mocked(hasConsent).mockResolvedValue(true);
    vi.mocked(getPreferences).mockResolvedValue(prefs(true));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(realisticPayload), { status: 200 }));

    const result = await searchWeb(userId, conversationId, "Columbus Ohio\nweather today", { reason: "asked", timezone: "America/New_York" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init?.headers as Headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input).toBe("Columbus Ohio weather today"); // query only, newline stripped
    expect(body.tools).toEqual([{ type: "web_search", search_context_size: "low", user_location: { type: "approximate", timezone: "America/New_York" } }]);
    expect(body.tool_choice).toBe("auto");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.instructions).toContain("2 to 4 short, spoken-style sentences");
    expect(body.instructions).toMatch(/Today is \w+, \w+ \d+, \d{4}\./);
    expect(JSON.stringify(body)).not.toContain("MEMORY");

    expect(result.refused).toBe(false);
    expect(result.searchCalls).toBe(1);
    expect(result.sources).toHaveLength(2);
    expect(result.answer).toContain("Columbus is sunny");
    expect(result.costUsd).toBe(0.0101);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        conversationId,
        modelId: "gpt-6-luna",
        kind: "web_search",
        searchCalls: 1,
        inputTextTokens: 1200,
        cachedTextTokens: 200,
        outputTextTokens: 80,
      }),
    );
  });

  it("returns a spoken fallback (not a throw) when the upstream call fails", async () => {
    vi.mocked(hasConsent).mockResolvedValue(true);
    vi.mocked(getPreferences).mockResolvedValue(prefs(true));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }));
    const result = await searchWeb(userId, conversationId, "scores");
    expect(result).toMatchObject({ refused: true, reason: "upstream_error", costUsd: 0 });
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
