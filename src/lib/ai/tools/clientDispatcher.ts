"use client";
/**
 * Browser-side ToolDispatcher: posts a model function call to our server
 * (/api/tools/dispatch, owned by the tools agent) and maps the response to a
 * ToolCallResult. Never throws — a failed tool returns a JSON error string so
 * the model can recover in words instead of the conversation hanging.
 */
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { ToolDispatchResponse } from "@/lib/api/contracts";
import type { ToolCallRequest, ToolCallResult, ToolDispatcher } from "@/lib/ai/adapters/types";

export type UiAction = NonNullable<ToolCallResult["uiAction"]>;

const UI_ACTION_TYPES = new Set<UiAction["type"]>([
  "consent_prompt",
  "memory_saved",
  "memory_deleted",
  "humor_changed",
  "name_set",
  "end_conversation",
]);

/** Narrow an untyped uiAction record from the server to the adapter's union. */
export function narrowUiAction(raw: unknown): UiAction | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const type = rec.type;
  if (typeof type !== "string" || !UI_ACTION_TYPES.has(type as UiAction["type"])) return undefined;
  switch (type as UiAction["type"]) {
    case "consent_prompt": {
      const scope = rec.scope;
      if (scope === "memory" || scope === "sensitive_memory" || scope === "web_search") return { type, scope };
      return undefined;
    }
    case "memory_saved":
      if (typeof rec.memoryId === "string" && typeof rec.content === "string") {
        return { type, memoryId: rec.memoryId, content: rec.content };
      }
      return undefined;
    case "memory_deleted":
      return typeof rec.memoryId === "string" ? { type, memoryId: rec.memoryId } : undefined;
    case "humor_changed":
      if (rec.level === "off" || rec.level === "gentle" || rec.level === "playful") return { type, level: rec.level };
      return undefined;
    case "name_set":
      return typeof rec.name === "string" ? { type, name: rec.name } : undefined;
    case "end_conversation":
      return { type };
    default:
      return undefined;
  }
}

export type DispatchFetch = <T>(path: string, init: Parameters<typeof apiFetch>[1]) => Promise<T>;

export class ClientToolDispatcher implements ToolDispatcher {
  constructor(private readonly fetchJson: DispatchFetch = apiFetch) {}

  async dispatch(conversationId: string, call: ToolCallRequest): Promise<ToolCallResult> {
    try {
      const response = await this.fetchJson<ToolDispatchResponse>("/api/tools/dispatch", {
        method: "POST",
        json: { conversationId, callId: call.callId, name: call.name, arguments: call.arguments },
      });
      return {
        output: typeof response.output === "string" ? response.output : JSON.stringify(response.output ?? {}),
        ...(response.sources?.length ? { sources: response.sources } : {}),
        ...(narrowUiAction(response.uiAction) ? { uiAction: narrowUiAction(response.uiAction) } : {}),
      };
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : "tool_failed";
      const message = error instanceof Error ? error.message : "Tool call failed";
      return { output: JSON.stringify({ error: code, message }) };
    }
  }
}

export const clientToolDispatcher = new ClientToolDispatcher();
