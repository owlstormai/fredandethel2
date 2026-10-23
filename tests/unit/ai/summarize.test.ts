import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "@/lib/types";

vi.mock("@/lib/usage/tracker", () => ({ recordUsage: vi.fn() }));

import { buildSummaryInstructions, buildTranscript, keywordsOf, matchesTombstones, parseSummaryJson, SENSITIVE_OMISSION_INSTRUCTION, summarizeConversation } from "@/lib/ai/summarize";
import { recordUsage } from "@/lib/usage/tracker";

const KEY = "sk-test-0123456789abcdef0123456789";
const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

let seq = 0;
const msg = (role: ConversationMessage["role"], content: string): ConversationMessage => ({
  id: `m${++seq}`,
  conversationId,
  userId,
  seq,
  role,
  content,
  itemId: null,
  toolName: null,
  toolPayload: null,
  sources: null,
  createdAt: "2026-10-22T10:00:00Z",
});

const messages = [
  msg("system", "ignored"),
  msg("assistant", "Hello, I'm Fred. What should I call you?"),
  msg("user", "Call me Margaret. My daughter Anne lives in Ohio and I garden every morning."),
  msg("tool", '{"answer":"ignored"}'),
  msg("assistant", "Lovely. What do you grow?"),
  msg("user", "Tomatoes, mostly. My knee has been bothering me though."),
];

function responsesBody(text: string) {
  return {
    id: "resp_1",
    output: [{ type: "message", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 400, input_tokens_details: { cached_tokens: 0 }, output_tokens: 120 },
  };
}

describe("summarize helpers", () => {
  it("builds User:/Companion: lines from the most recent messages within the cap", () => {
    const t = buildTranscript(messages);
    expect(t.split("\n")).toEqual([
      "Companion: Hello, I'm Fred. What should I call you?",
      "User: Call me Margaret. My daughter Anne lives in Ohio and I garden every morning.",
      "Companion: Lovely. What do you grow?",
      "User: Tomatoes, mostly. My knee has been bothering me though.",
    ]);
    const capped = buildTranscript(messages, 80);
    expect(capped).toBe("User: Tomatoes, mostly. My knee has been bothering me though.");
  });

  it("parses strict JSON, fenced JSON and coerces bad enums", () => {
    const fenced = "```json\n{\"summary\":\"Margaret talked about her garden.\",\"candidates\":[{\"content\":\"Margaret grows tomatoes.\",\"kind\":\"hobby\",\"category\":\"interest\",\"sensitivity\":\"normal\",\"status\":\"reported\"}]}\n```";
    const parsed = parseSummaryJson(fenced);
    expect(parsed?.summary).toBe("Margaret talked about her garden.");
    expect(parsed?.candidates).toEqual([{ content: "Margaret grows tomatoes.", kind: "fact", category: "interest", sensitivity: "normal", status: "reported" }]);
    expect(parseSummaryJson("Sure! Here you go: {\"summary\":\"x\",\"candidates\":\"nope\"} thanks")).toEqual({ summary: "x", candidates: [] });
    expect(parseSummaryJson("not json at all")).toBeNull();
    expect(parseSummaryJson("{\"candidates\":[]}")).toBeNull();
  });

  it("forces sensitive categories to be marked sensitive", () => {
    const parsed = parseSummaryJson('{"summary":"s","candidates":[{"content":"Her knee hurts.","kind":"fact","category":"health","sensitivity":"normal","status":"reported"}]}');
    expect(parsed?.candidates[0].sensitivity).toBe("sensitive");
  });

  it("matches tombstones on >= 2 shared keywords", () => {
    expect(keywordsOf("Her daughter Anne lives in Ohio.")).toEqual(["daughter", "anne", "lives", "ohio"]);
    const tomb = ["daughter", "ohio"];
    expect(matchesTombstones("Her daughter Anne lives in Ohio.", tomb)).toBe(true);
    expect(matchesTombstones("Her daughter likes tea.", tomb)).toBe(false);
    expect(matchesTombstones("Anything", [])).toBe(false);
  });
});

describe("summarizeConversation", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(recordUsage).mockResolvedValue({ estimatedCostUsd: 0.0001 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns null without a key and does not call fetch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await summarizeConversation(userId, conversationId, messages, { tombstoneKeywords: [], preferredName: "Margaret" });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an empty transcript", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    expect(await summarizeConversation(userId, conversationId, [msg("tool", "x")], { tombstoneKeywords: [], preferredName: null })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Responses API, parses JSON, filters tombstoned candidates and records usage", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    const payload = {
      summary: "Margaret introduced herself, talked about gardening and mentioned her knee.",
      candidates: [
        { content: "Margaret's daughter Anne lives in Ohio.", kind: "relationship", category: "family", sensitivity: "normal", status: "reported" },
        { content: "Margaret grows tomatoes in her garden every morning.", kind: "interest", category: "interest", sensitivity: "normal", status: "reported" },
        { content: "Margaret's knee has been bothering her.", kind: "fact", category: "health", sensitivity: "sensitive", status: "reported" },
        { content: "Margaret probably lives alone.", kind: "fact", category: "identity", sensitivity: "normal", status: "inferred" },
      ],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responsesBody(JSON.stringify(payload))), { status: 200 }));

    const result = await summarizeConversation(userId, conversationId, messages, {
      tombstoneKeywords: ["daughter", "anne", "ohio"],
      preferredName: "Margaret",
    });

    expect(result).not.toBeNull();
    expect(result!.modelId).toBe("gpt-6-luna");
    expect(result!.summary).toContain("Margaret introduced herself");
    expect(result!.candidates.map((c) => c.content)).toEqual([
      "Margaret grows tomatoes in her garden every morning.",
      "Margaret's knee has been bothering her.",
      "Margaret probably lives alone.",
    ]);
    expect(result!.candidates.find((c) => c.category === "health")?.sensitivity).toBe("sensitive");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input).toContain("User: Call me Margaret.");
    expect(body.input).not.toContain("ignored");
    expect(body.instructions).toContain("ONLY a JSON object");
    expect(body.instructions).toContain("Margaret");
    expect(body.instructions).toContain("unless they were the main point of the conversation"); // allowSensitive defaults to true
    expect(body.instructions).not.toContain(SENSITIVE_OMISSION_INSTRUCTION);
    expect(body.tools).toBeUndefined();

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId, conversationId, modelId: "gpt-6-luna", kind: "summary", inputTextTokens: 400, outputTextTokens: 120 }),
    );
  });

  it("tells the model to omit health, finances, grief and family-conflict details entirely when allowSensitive is false", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responsesBody(JSON.stringify({ summary: "Margaret talked about her garden.", candidates: [] }))), { status: 200 }));
    const result = await summarizeConversation(userId, conversationId, messages, { tombstoneKeywords: [], preferredName: "Margaret", allowSensitive: false });
    expect(result?.summary).toBe("Margaret talked about her garden.");
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.instructions).toContain(SENSITIVE_OMISSION_INSTRUCTION);
    expect(body.instructions).toMatch(/Omit health, finances, grief and family-conflict details entirely/);
    expect(body.instructions).not.toContain("unless they were the main point of the conversation");
    expect(buildSummaryInstructions("Margaret", true)).not.toContain(SENSITIVE_OMISSION_INSTRUCTION);
    expect(buildSummaryInstructions(null, false)).toContain(SENSITIVE_OMISSION_INSTRUCTION);
  });

  it("returns null (never throws) on unparseable output or upstream failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responsesBody("I cannot do that.")), { status: 200 }));
    expect(await summarizeConversation(userId, conversationId, messages, { tombstoneKeywords: [], preferredName: null })).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 }));
    expect(await summarizeConversation(userId, conversationId, messages, { tombstoneKeywords: [], preferredName: null })).toBeNull();
  });
});
