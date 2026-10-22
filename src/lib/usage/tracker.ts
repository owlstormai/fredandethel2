/**
 * Usage tracking — SEAM FILE. Owner: AI/usage agent.
 * Used by: conversation telemetry route (C), tool dispatcher, summarizer, session minting.
 */
import type { TokenUsage, UsageKind, UsageSummary } from "@/lib/types";

export interface RecordUsageInput extends Partial<TokenUsage> {
  userId: string;
  conversationId?: string | null;
  modelId: string;
  kind: UsageKind;
  searchCalls?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

export async function recordUsage(_input: RecordUsageInput): Promise<{ estimatedCostUsd: number }> {
  throw new Error("not implemented: recordUsage");
}

export type CapCheck = { allowed: true } | { allowed: false; reason: "daily_cap" | "user_daily_cap"; detail: string };

export async function checkCaps(_userId: string): Promise<CapCheck> {
  throw new Error("not implemented: checkCaps");
}

export async function getUsageSummary(_userId: string, _range: UsageSummary["range"]): Promise<UsageSummary> {
  throw new Error("not implemented: getUsageSummary");
}
