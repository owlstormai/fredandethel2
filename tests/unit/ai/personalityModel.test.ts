import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usage/tracker", () => ({ recordUsage: vi.fn() }));

import { analyzeStyleWithModel, buildStyleInstructions, parseStyleJson, STYLE_SENSITIVE_GUARD } from "@/lib/ai/personalityModel";
import { recordUsage } from "@/lib/usage/tracker";

const KEY = "sk-test-0123456789abcdef0123456789";
const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const transcript = [
  "Companion: Hello, I'm Fred. What's on your mind?",
  "User: Haha, my garden is mostly weeds with ambitions, but the tomatoes don't know that yet!",
  "Companion: A garden with ambitions. What's coming in?",
  "User: Tomatoes, if the squirrels allow it. No pun intended, but my knees are the real weeds. Lol.",
  "User: Baseball tonight! The Guardians will break my heart again, but that's the fun, isn't it?",
];

function responsesBody(text: string) {
  return {
    id: "resp_1",
    output: [{ type: "message", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 300, input_tokens_details: { cached_tokens: 0 }, output_tokens: 90 },
  };
}

const payload = {
  scores: { humor: 0.9, energy: 0.6, formality: 0.2, verbosity: 0.5, warmth: 0.6, curiosity: 0.5, storytelling: 0.3, directness: 0.2 },
  humorStyle: ["wordplay", "self-deprecating", "bogus"],
  topics: ["garden", "baseball", "blood pressure pills"],
  phrases: ["no pun intended"],
  pace: "steady",
  notes: ["Jokes about getting older", "Worries about the mortgage"],
  summary: "You joke back readily, mostly wordplay, and you like the long version of a garden story.",
};

describe("buildStyleInstructions / parseStyleJson", () => {
  it("asks for strict JSON, describes style not facts, and forbids sensitive and protected content", () => {
    const text = buildStyleInstructions();
    expect(text).toContain("ONLY a JSON object");
    expect(text).toContain(STYLE_SENSITIVE_GUARD);
    expect(text).toMatch(/Describe STYLE, not facts/);
    expect(text).toMatch(/health/);
    expect(text).toMatch(/finances/);
    expect(text).toMatch(/grief/);
    expect(text).toMatch(/protected characteristic/);
    expect(text).toMatch(/words only reach you as text/);
    expect(text).toMatch(/heuristic estimate/i);
  });

  it("parses fenced or chatty JSON, coerces bad enums and drops sensitive topics/notes whatever the model said", () => {
    const parsed = parseStyleJson("Sure:\n```json\n" + JSON.stringify(payload) + "\n```");
    expect(parsed).not.toBeNull();
    expect(parsed!.traits.scores.humor).toBe(0.9);
    expect(parsed!.traits.humorStyle).toEqual(["wordplay", "self-deprecating"]);
    expect(parsed!.traits.topics).toEqual(["garden", "baseball"]);
    expect(parsed!.traits.notes).toEqual(["Jokes about getting older"]);
    expect(parsed!.traits.phrases).toEqual(["no pun intended"]);
    expect(parsed!.traits.pace).toBe("steady");
    expect(parsed!.summary).toMatch(/^You joke back readily/);
    expect(parseStyleJson("not json")).toBeNull();
    expect(parseStyleJson('{"scores": {}}')).toBeNull(); // summary required
  });

  it("blanks a summary that carries sensitive detail", () => {
    const parsed = parseStyleJson(JSON.stringify({ ...payload, summary: "You talk a lot about your doctor and your pills." }));
    expect(parsed?.summary).toBe("");
  });
});

describe("analyzeStyleWithModel", () => {
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

  it("returns null without a key and never calls fetch", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await analyzeStyleWithModel(userId, conversationId, transcript, null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("returns null for an empty transcript", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    expect(await analyzeStyleWithModel(userId, conversationId, [], null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the Responses API with the heuristic hint, parses the JSON and records usage as a 'style' summary", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responsesBody(JSON.stringify(payload))), { status: 200 }));
    const existing = { ...parseStyleJson(JSON.stringify(payload))!.traits, humorStyle: ["dry" as const] };
    const result = await analyzeStyleWithModel(userId, conversationId, transcript, existing);
    expect(result).not.toBeNull();
    expect(result!.traits.scores.humor).toBe(0.9);
    expect(result!.traits.topics).toEqual(["garden", "baseball"]);
    expect(result!.summary).toMatch(/joke back readily/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gpt-6-luna");
    expect(body.instructions).toContain(STYLE_SENSITIVE_GUARD);
    expect(body.input).toContain("TRANSCRIPT:");
    expect(body.input).toContain("User: Haha, my garden");
    expect(body.input).toMatch(/HEURISTIC ESTIMATE \(hint only/);
    expect(body.input).toContain("CURRENT PROFILE");
    expect(body.tools).toBeUndefined();
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId, conversationId, modelId: "gpt-6-luna", kind: "summary", inputTextTokens: 300, outputTextTokens: 90, metadata: expect.objectContaining({ purpose: "style" }) }),
    );
  });

  it("returns null (never throws) on unparsable output or an upstream failure", async () => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(responsesBody("I cannot do that.")), { status: 200 }));
    expect(await analyzeStyleWithModel(userId, conversationId, transcript, null)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "nope", type: "server_error" } }), { status: 500 }));
    expect(await analyzeStyleWithModel(userId, conversationId, transcript, null)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await analyzeStyleWithModel(userId, conversationId, transcript, null)).toBeNull();
  });
});
