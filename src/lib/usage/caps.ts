/**
 * Cost-cap configuration (env-driven) and day boundaries. Caps are compared
 * against SUM(estimated_cost_usd) of usage_events since 00:00 UTC.
 */
import { MAX_REALTIME_SESSION_SECONDS } from "@/lib/ai/models";

export const DEFAULT_DAILY_COST_CAP_USD = 20;
export const DEFAULT_PER_USER_DAILY_COST_CAP_USD = 10;
export const DEFAULT_MAX_SESSION_MINUTES = 30;

export interface CapConfig {
  dailyCostCapUsd: number;
  perUserDailyCostCapUsd: number;
  maxSessionMinutes: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getCapConfig(): CapConfig {
  const requestedMinutes = envNumber("COMPANION_MAX_SESSION_MINUTES", DEFAULT_MAX_SESSION_MINUTES);
  return {
    dailyCostCapUsd: envNumber("COMPANION_DAILY_COST_CAP_USD", DEFAULT_DAILY_COST_CAP_USD),
    perUserDailyCostCapUsd: envNumber("COMPANION_PER_USER_DAILY_COST_CAP_USD", DEFAULT_PER_USER_DAILY_COST_CAP_USD),
    maxSessionMinutes: Math.min(requestedMinutes, MAX_REALTIME_SESSION_SECONDS / 60),
  };
}

/** Effective per-session limit in seconds: min(OpenAI 60-minute limit, env). */
export function getMaxSessionSeconds(): number {
  return Math.round(Math.min(MAX_REALTIME_SESSION_SECONDS, getCapConfig().maxSessionMinutes * 60));
}

/** Start of the current UTC day. */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Start of the range for a usage summary. null = all time. */
export function rangeStart(range: "today" | "7d" | "all", now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const today = utcDayStart(now);
  if (range === "today") return today;
  return new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
}

export function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
