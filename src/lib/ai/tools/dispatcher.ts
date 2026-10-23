/**
 * Server-side tool dispatcher. The Realtime model (in the browser session)
 * asks for a function call; the browser posts it to /api/tools/dispatch; this
 * module validates and executes it against the application's own services.
 *
 * Contract: always return something the model can read. Bad arguments and
 * service failures become explanatory `output` text (HTTP 200) rather than
 * errors, except for auth/ownership/rate-limit problems which are HttpErrors.
 * Logs carry tool name and duration only — never arguments or outputs.
 */
import type { ToolCallResult } from "@/lib/ai/adapters/types";
import { isToolName, toolArgumentSchemas, type ToolArgs, type ToolName } from "@/lib/ai/tools/definitions";
import { searchWeb } from "@/lib/ai/tools/search";
import type { ToolDispatchResponse } from "@/lib/api/contracts";
import { HttpError } from "@/lib/api/respond";
import { appendMessage, getConversation } from "@/lib/database/conversations";
import { recordToneObservation } from "@/lib/memory/personalityService";
import {
  forgetMemory,
  recallMemories,
  recordConsent,
  rememberMemory,
  setHumorLevel,
  setPreferredName,
} from "@/lib/memory/service";
import { logError, logInfo } from "@/lib/privacy/logging";
import { checkRateLimit } from "@/lib/privacy/rateLimit";
import { DISTRESS_TONES } from "@/lib/memory/tone";
import type { User } from "@/lib/types";

export interface ToolDispatchInput {
  conversationId: string;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

type UiAction = NonNullable<ToolCallResult["uiAction"]>;
type Result = ToolDispatchResponse & { uiAction?: UiAction };

export const TOOL_OUTPUTS = {
  unknown: "Unknown tool.",
  saved: "Saved.",
  savedUnconfirmed: "Saved as a note (mentioned, not confirmed). Verify with the user before relying on it.",
  consentRequired: "Memory is off. Ask the user if they'd like you to remember things, and call record_consent if they agree.",
  sensitiveConsentRequired:
    "This is sensitive (health, money, grief or family). The user has not agreed to keep sensitive things. Ask whether they'd like you to remember sensitive topics too, and call record_consent with scope sensitive_memory if they agree.",
  tombstoned: "The user previously asked you to forget this. Do not save it or bring it up.",
  duplicate: "Already remembered.",
  nothingToForget: "Nothing saved matched that, so nothing was deleted.",
  nothingRecalled: "Nothing saved about that.",
  consentPromptShown: "A consent card is shown; also ask them out loud.",
  ending: "Ending the conversation. Say a short, warm goodbye.",
  failed: "That tool did not work just now. Carry on without it and do not mention the error unless asked.",
  searchNotLive:
    "Web search is only available in live conversations, not in demo mode. Say so plainly and offer to talk about it anyway.",
  toneNoted: "Noted.",
  toneSerious: "Noted. Drop humor for the rest of this conversation and slow down.",
} as const;

/** Distress at this intensity (or an explicit `serious`) switches humor off for the conversation. */
export const TONE_SERIOUS_INTENSITY = 0.6;

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

async function handleRemember(userId: string, conversationId: string, args: ToolArgs<"remember">): Promise<Result> {
  const result = await rememberMemory(userId, {
    content: args.content,
    kind: args.kind,
    category: args.category,
    sensitivity: args.sensitivity,
    userConfirmed: args.user_confirmed,
    userWords: args.user_words,
    sourceConversationId: conversationId,
  });
  if (result.ok) {
    return {
      output: result.status === "confirmed" ? TOOL_OUTPUTS.saved : TOOL_OUTPUTS.savedUnconfirmed,
      uiAction: { type: "memory_saved", memoryId: result.memory.id, content: result.memory.content },
    };
  }
  switch (result.reason) {
    case "consent_required":
      return { output: TOOL_OUTPUTS.consentRequired, uiAction: { type: "consent_prompt", scope: "memory" } };
    case "sensitive_consent_required":
      return { output: TOOL_OUTPUTS.sensitiveConsentRequired, uiAction: { type: "consent_prompt", scope: "sensitive_memory" } };
    case "tombstoned":
      return { output: TOOL_OUTPUTS.tombstoned };
    case "duplicate":
      return { output: TOOL_OUTPUTS.duplicate };
  }
}

async function handleForget(userId: string, args: ToolArgs<"forget">): Promise<Result> {
  const { deleted } = await forgetMemory(userId, { text: args.text });
  if (deleted.length === 0) return { output: TOOL_OUTPUTS.nothingToForget };
  return {
    output: deleted.length === 1 ? "Forgotten. It will not come back." : `Forgotten ${deleted.length} related items. They will not come back.`,
    uiAction: { type: "memory_deleted", memoryId: deleted[0].id },
  };
}

async function handleRecall(userId: string, args: ToolArgs<"recall_memories">): Promise<Result> {
  const memories = await recallMemories(userId, args.query, 8);
  if (memories.length === 0) return { output: TOOL_OUTPUTS.nothingRecalled };
  return { output: JSON.stringify(memories.map((m) => ({ content: m.content, status: m.status }))) };
}

async function handleRecordConsent(userId: string, args: ToolArgs<"record_consent">): Promise<Result> {
  await recordConsent(userId, args.scope, args.granted, "voice", args.user_words);
  return { output: `Consent recorded (${args.scope}: ${args.granted ? "yes" : "no"}).` };
}

async function handleSearch(userId: string, conversationId: string, args: ToolArgs<"search_web">): Promise<Result> {
  const result = await searchWeb(userId, conversationId, args.query, { reason: args.reason });
  if (result.refused) return { output: result.answer };

  try {
    await appendMessage({
      userId,
      conversationId,
      role: "tool",
      content: result.answer,
      toolName: "search_web",
      toolPayload: { query: args.query, searchCalls: result.searchCalls, costUsd: result.costUsd },
      sources: result.sources,
    });
  } catch (error) {
    logError("search_transcript_not_saved", error);
  }
  return {
    output: JSON.stringify({ answer: result.answer, sources: result.sources }),
    sources: result.sources,
  };
}

/**
 * observe_tone: the live model heard something in the voice. The observation is
 * stored only when memory is on (the service checks consent); the behavioural
 * reply goes back either way. No saved preference changes — "drop humor" is for
 * THIS conversation, in the model's own context.
 */
async function handleObserveTone(userId: string, conversationId: string, args: ToolArgs<"observe_tone">): Promise<Result> {
  const serious = args.serious || (DISTRESS_TONES.has(args.tone) && args.intensity >= TONE_SERIOUS_INTENSITY);
  await recordToneObservation(userId, {
    conversationId,
    tone: args.tone,
    intensity: args.intensity,
    intent: args.intent ?? null,
    cue: args.cue ?? null,
    source: "model",
  });
  return { output: serious ? TOOL_OUTPUTS.toneSerious : TOOL_OUTPUTS.toneNoted };
}

async function execute(user: User, conversationId: string, name: ToolName, args: unknown): Promise<Result> {
  switch (name) {
    case "remember":
      return handleRemember(user.id, conversationId, args as ToolArgs<"remember">);
    case "forget":
      return handleForget(user.id, args as ToolArgs<"forget">);
    case "recall_memories":
      return handleRecall(user.id, args as ToolArgs<"recall_memories">);
    case "record_consent":
      return handleRecordConsent(user.id, args as ToolArgs<"record_consent">);
    case "request_memory_consent":
      return { output: TOOL_OUTPUTS.consentPromptShown, uiAction: { type: "consent_prompt", scope: "memory" } };
    case "set_preferred_name": {
      const { name: preferred } = args as ToolArgs<"set_preferred_name">;
      await setPreferredName(user.id, preferred);
      return { output: `Name set to ${preferred}.`, uiAction: { type: "name_set", name: preferred } };
    }
    case "set_humor_level": {
      const { level } = args as ToolArgs<"set_humor_level">;
      await setHumorLevel(user.id, level);
      return { output: `Humor level set to ${level}.`, uiAction: { type: "humor_changed", level } };
    }
    case "search_web":
      return handleSearch(user.id, conversationId, args as ToolArgs<"search_web">);
    case "observe_tone":
      return handleObserveTone(user.id, conversationId, args as ToolArgs<"observe_tone">);
    case "end_conversation":
      return { output: TOOL_OUTPUTS.ending, uiAction: { type: "end_conversation" } };
  }
}

export async function dispatchTool(user: User, input: ToolDispatchInput): Promise<ToolDispatchResponse> {
  const started = Date.now();
  // 60 tool calls / minute / user. Uses the shared limiter's 60/min "memories"
  // group under a "tools:" key so it cannot collide with the memory routes.
  // TODO(integration): switch to a dedicated "tools" group if Agent C adds one to RATE_LIMITS.
  const limit = checkRateLimit("tools", user.id);
  if (!limit.allowed) {
    throw new HttpError(429, "rate_limited", "Too many tool calls. Slow down a little.", { retryAfterSeconds: limit.retryAfterSeconds });
  }

  const conversation = await getConversation(user.id, input.conversationId);
  if (!conversation) throw new HttpError(404, "conversation_not_found", "That conversation does not exist.");

  if (!isToolName(input.name)) {
    logInfo("tool_dispatch", { name: "unknown", ms: Date.now() - started, ok: false });
    return { output: TOOL_OUTPUTS.unknown };
  }
  // Demo mode is "no paid API": search_web calls the Responses API, so it is
  // only honoured for a live conversation of a non-demo user.
  if (input.name === "search_web" && (user.isDemo || conversation.mode !== "live")) {
    logInfo("tool_dispatch", { name: input.name, ms: Date.now() - started, ok: false, reason: "not_live" });
    return { output: TOOL_OUTPUTS.searchNotLive };
  }

  const parsed = toolArgumentSchemas[input.name].safeParse(input.arguments ?? {});
  if (!parsed.success) {
    logInfo("tool_dispatch", { name: input.name, ms: Date.now() - started, ok: false, reason: "invalid_arguments" });
    return { output: `Invalid arguments for ${input.name}: ${formatIssues(parsed.error.issues)}. Fix them and call the tool again.` };
  }

  try {
    const result = await execute(user, input.conversationId, input.name, parsed.data);
    logInfo("tool_dispatch", { name: input.name, ms: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    logError("tool_dispatch_failed", { name: input.name, ms: Date.now() - started, error: (error as Error).message });
    return { output: TOOL_OUTPUTS.failed };
  }
}
