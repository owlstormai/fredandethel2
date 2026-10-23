/**
 * Function tools exposed to the Realtime model, plus zod schemas used by the
 * server dispatcher to validate the model's arguments.
 *
 * The JSON Schemas are hand-written (not generated) so what the model sees is
 * explicit and reviewable; tests assert parity with the zod schemas.
 * Tool shape per docs/API_VERIFICATION.md §3: `{ type: "function", name,
 * description, parameters }` with the JSON Schema at the top level.
 */
import { z } from "zod";
import type { FunctionToolDefinition } from "@/lib/ai/realtime/events";
import { INTENTS, TONES } from "@/lib/memory/tone";

export const TOOL_NAMES = [
  "remember",
  "forget",
  "recall_memories",
  "record_consent",
  "request_memory_consent",
  "set_preferred_name",
  "set_humor_level",
  "search_web",
  "observe_tone",
  "end_conversation",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const MEMORY_KINDS = ["fact", "preference", "interest", "relationship", "story"] as const;
export const MEMORY_CATEGORIES = [
  "identity", "family", "friends", "interest", "routine", "preference",
  "story", "health", "finances", "grief", "other",
] as const;
export const SENSITIVITIES = ["normal", "sensitive"] as const;
export const CONSENT_SCOPES = ["memory", "sensitive_memory", "web_search"] as const;
export const HUMOR_LEVELS = ["off", "gentle", "playful"] as const;
/** Channel 2 (how) and channel 3 (why) vocabularies; shared with the demo-mode classifier. */
export const TONE_VALUES = TONES;
export const INTENT_VALUES = INTENTS;

// ---------------------------------------------------------------------------
// zod schemas (server-side validation of model arguments)
// ---------------------------------------------------------------------------

export const rememberArgsSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  kind: z.enum(MEMORY_KINDS),
  category: z.enum(MEMORY_CATEGORIES),
  sensitivity: z.enum(SENSITIVITIES),
  user_confirmed: z.boolean(),
  user_words: z.string().trim().max(1000).optional(),
}).strict();

export const forgetArgsSchema = z.object({
  text: z.string().trim().min(1).max(500),
}).strict();

export const recallMemoriesArgsSchema = z.object({
  query: z.string().trim().min(1).max(300),
}).strict();

export const recordConsentArgsSchema = z.object({
  scope: z.enum(CONSENT_SCOPES),
  granted: z.boolean(),
  user_words: z.string().trim().min(1).max(1000),
}).strict();

export const requestMemoryConsentArgsSchema = z.object({}).strict();

export const setPreferredNameArgsSchema = z.object({
  name: z.string().trim().min(1).max(60),
}).strict();

export const setHumorLevelArgsSchema = z.object({
  level: z.enum(HUMOR_LEVELS),
}).strict();

export const searchWebArgsSchema = z.object({
  query: z.string().trim().min(1).max(300),
  reason: z.string().trim().max(200).optional(),
}).strict();

export const observeToneArgsSchema = z.object({
  tone: z.enum(TONE_VALUES),
  intensity: z.number().min(0).max(1),
  intent: z.enum(INTENT_VALUES).optional(),
  cue: z.string().trim().max(200).optional(),
  serious: z.boolean(),
}).strict();

export const endConversationArgsSchema = z.object({}).strict();

export const toolArgumentSchemas = {
  remember: rememberArgsSchema,
  forget: forgetArgsSchema,
  recall_memories: recallMemoriesArgsSchema,
  record_consent: recordConsentArgsSchema,
  request_memory_consent: requestMemoryConsentArgsSchema,
  set_preferred_name: setPreferredNameArgsSchema,
  set_humor_level: setHumorLevelArgsSchema,
  search_web: searchWebArgsSchema,
  observe_tone: observeToneArgsSchema,
  end_conversation: endConversationArgsSchema,
} as const satisfies Record<ToolName, z.ZodType>;

export type ToolArgs<N extends ToolName> = z.infer<(typeof toolArgumentSchemas)[N]>;

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// JSON Schema definitions shown to the model
// ---------------------------------------------------------------------------

const EMPTY_PARAMS = { type: "object", properties: {}, required: [], additionalProperties: false } as const;

const rememberTool: FunctionToolDefinition = {
  type: "function",
  name: "remember",
  description:
    "Save one thing about the user for future conversations. Only call with user_confirmed=true after the user clearly said yes to \"Want me to remember that?\". Requires memory to be enabled; if it is not, the result will say so.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "One plain sentence, third person, e.g. \"Her daughter Anne lives in Ohio.\"",
      },
      kind: { type: "string", enum: [...MEMORY_KINDS], description: "What sort of thing this is." },
      category: { type: "string", enum: [...MEMORY_CATEGORIES], description: "Topic bucket." },
      sensitivity: {
        type: "string",
        enum: [...SENSITIVITIES],
        description: "\"sensitive\" for health, finances, grief or family conflict.",
      },
      user_confirmed: {
        type: "boolean",
        description: "True only if the user explicitly agreed to save this exact statement.",
      },
      user_words: { type: "string", description: "The user's own words, as closely as you heard them." },
    },
    required: ["content", "kind", "category", "sensitivity", "user_confirmed"],
    additionalProperties: false,
  },
};

const forgetTool: FunctionToolDefinition = {
  type: "function",
  name: "forget",
  description: "Delete saved memories matching the user's request, e.g. when they say \"forget what I said about my knee\".",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "What to forget, in a few words (topic or the statement itself)." },
    },
    required: ["text"],
    additionalProperties: false,
  },
};

const recallMemoriesTool: FunctionToolDefinition = {
  type: "function",
  name: "recall_memories",
  description:
    "Look up what has been saved about a topic. Use when the user asks what you remember, or to verify a 'mentioned, not confirmed' item before relying on it.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Topic or keywords, e.g. \"grandchildren\" or \"garden\"." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const recordConsentTool: FunctionToolDefinition = {
  type: "function",
  name: "record_consent",
  description:
    "Record that the user verbally agreed or declined: memory between chats (memory), keeping sensitive topics (sensitive_memory), or looking things up online (web_search). Always quote their words.",
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: [...CONSENT_SCOPES] },
      granted: { type: "boolean", description: "True if they agreed, false if they declined." },
      user_words: { type: "string", description: "Their words, e.g. \"Yes, you can remember that.\"" },
    },
    required: ["scope", "granted", "user_words"],
    additionalProperties: false,
  },
};

const requestMemoryConsentTool: FunctionToolDefinition = {
  type: "function",
  name: "request_memory_consent",
  description:
    "Memory is off and the user asked you to remember something (or it would clearly help). Shows the user a consent card. Also ask them out loud.",
  parameters: EMPTY_PARAMS,
};

const setPreferredNameTool: FunctionToolDefinition = {
  type: "function",
  name: "set_preferred_name",
  description: "Record what the user would like to be called.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name or nickname they gave, e.g. \"Margaret\" or \"Peg\"." },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

const setHumorLevelTool: FunctionToolDefinition = {
  type: "function",
  name: "set_humor_level",
  description:
    "Change how much humor you use, when the user asks (\"less joking\" -> gentle or off; \"no jokes\" -> off; \"more jokes\" -> playful).",
  parameters: {
    type: "object",
    properties: {
      level: { type: "string", enum: [...HUMOR_LEVELS] },
    },
    required: ["level"],
    additionalProperties: false,
  },
};

const searchWebTool: FunctionToolDefinition = {
  type: "function",
  name: "search_web",
  description:
    "Look up current information (today's news, weather, sports scores, prices). Put ONLY the question in the query: never the user's name, memories or personal details. Results include sources to mention.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "A short, self-contained search question (under 300 characters)." },
      reason: { type: "string", description: "A few words on why, e.g. \"asked about tomorrow's weather\"." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const observeToneTool: FunctionToolDefinition = {
  type: "function",
  name: "observe_tone",
  description:
    "Note HOW the user sounds (tone) and WHY they seem to be talking (intent) when it is notable or changes — not every turn, a few times per conversation at most. You can hear the voice; report what you hear. The result tells you how to adjust. Nothing is read aloud.",
  parameters: {
    type: "object",
    properties: {
      tone: { type: "string", enum: [...TONE_VALUES], description: "What you hear: joking, warm, frustrated, upset or sad, anxious, confused, tired, joyful, or neutral." },
      intensity: { type: "number", description: "0 to 1, how strong it is." },
      intent: { type: "string", enum: [...INTENT_VALUES], description: "Why they seem to be saying it." },
      cue: { type: "string", description: "A few words on what gave it away (under 200 characters), e.g. \"long sigh, 'nothing works'\"." },
      serious: { type: "boolean", description: "True if the conversation has turned serious and humor should stop for the rest of it." },
    },
    required: ["tone", "intensity", "serious"],
    additionalProperties: false,
  },
};

const endConversationTool: FunctionToolDefinition = {
  type: "function",
  name: "end_conversation",
  description: "The user said goodbye or asked to stop. Say a short, warm goodbye first, then call this.",
  parameters: EMPTY_PARAMS,
};

const ALL_TOOLS: Record<ToolName, FunctionToolDefinition> = {
  remember: rememberTool,
  forget: forgetTool,
  recall_memories: recallMemoriesTool,
  record_consent: recordConsentTool,
  request_memory_consent: requestMemoryConsentTool,
  set_preferred_name: setPreferredNameTool,
  set_humor_level: setHumorLevelTool,
  search_web: searchWebTool,
  observe_tone: observeToneTool,
  end_conversation: endConversationTool,
};

export function companionToolDefinitions(options: { searchEnabled: boolean }): FunctionToolDefinition[] {
  return TOOL_NAMES.filter((name) => name !== "search_web" || options.searchEnabled).map((name) => ALL_TOOLS[name]);
}

export function getToolDefinition(name: ToolName): FunctionToolDefinition {
  return ALL_TOOLS[name];
}
