"use client";
/**
 * Adapter factory. The UI never constructs adapters directly.
 */
import type { AppMode, CompanionVoice, PauseSensitivity } from "@/lib/types";
import { DemoAdapter, type DemoAdapterOptions } from "./demoAdapter";
import { OpenAIRealtimeAdapter, type OpenAIRealtimeAdapterOptions } from "./openaiRealtimeAdapter";
import type { ConversationAdapter } from "./types";

export interface AdapterFactoryOptions {
  companionVoice?: CompanionVoice;
  pauseSensitivity?: PauseSensitivity;
  demo?: DemoAdapterOptions;
  live?: OpenAIRealtimeAdapterOptions;
}

/** Adapters that can silence their own speaker output (developer comparison mode). */
export interface OutputMutableAdapter extends ConversationAdapter {
  setOutputMuted(muted: boolean): void;
}

export function isOutputMutable(adapter: ConversationAdapter): adapter is OutputMutableAdapter {
  return typeof (adapter as Partial<OutputMutableAdapter>).setOutputMuted === "function";
}

export function createAdapter(mode: AppMode, options: AdapterFactoryOptions = {}): ConversationAdapter {
  if (mode === "live") return new OpenAIRealtimeAdapter(options.live);
  return new DemoAdapter({
    companionVoice: options.companionVoice,
    pauseSensitivity: options.pauseSensitivity,
    ...options.demo,
  });
}

export type { ConversationAdapter } from "./types";
export { DemoAdapter } from "./demoAdapter";
export { OpenAIRealtimeAdapter } from "./openaiRealtimeAdapter";
