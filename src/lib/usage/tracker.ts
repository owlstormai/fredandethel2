/**
 * Usage tracking — SEAM FILE. Owner: AI/usage agent.
 * Used by: conversation telemetry route (C), tool dispatcher, summarizer, session minting.
 *
 * Every usage event is stored with its estimated cost (USD) and the pricing
 * version used, so later price changes never rewrite history. Caps compare
 * today's (UTC) summed estimates against env-configured limits.
 */
import { PRICING_VERSION } from "@/lib/ai/models";
import { query, queryOne } from "@/lib/database/client";
import { logWarn } from "@/lib/privacy/logging";
import type { TokenUsage, UsageKind, UsageSummary, UsageTotals } from "@/lib/types";
import { getCapConfig, rangeStart, utcDayStart } from "./caps";
import { estimateCost } from "./pricing";

export interface RecordUsageInput extends Partial<TokenUsage> {
  userId: string;
  conversationId?: string | null;
  modelId: string;
  kind: UsageKind;
  searchCalls?: number;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

function int(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function recordUsage(input: RecordUsageInput): Promise<{ estimatedCostUsd: number }> {
  const estimatedCostUsd = estimateCost(input);
  await query(
    `INSERT INTO usage_events (
       user_id, conversation_id, model_id, kind,
       input_text_tokens, input_audio_tokens, cached_text_tokens, cached_audio_tokens,
       output_text_tokens, output_audio_tokens, search_calls, duration_seconds,
       estimated_cost_usd, pricing_version, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
    [
      input.userId,
      input.conversationId ?? null,
      input.modelId,
      input.kind,
      int(input.inputTextTokens),
      int(input.inputAudioTokens),
      int(input.cachedTextTokens),
      int(input.cachedAudioTokens),
      int(input.outputTextTokens),
      int(input.outputAudioTokens),
      int(input.searchCalls),
      Math.max(0, Number(input.durationSeconds ?? 0)) || 0,
      estimatedCostUsd,
      PRICING_VERSION,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return { estimatedCostUsd };
}

export type CapCheck = { allowed: true } | { allowed: false; reason: "daily_cap" | "user_daily_cap"; detail: string };

interface SpendRow {
  total: string | number | null;
  user_total: string | number | null;
}

/** Today's (UTC) estimated spend: everyone, and this user. */
export async function getTodaySpend(userId: string, now: Date = new Date()): Promise<{ todaySpendUsd: number; userTodaySpendUsd: number }> {
  const row = await queryOne<SpendRow>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total,
            COALESCE(SUM(estimated_cost_usd) FILTER (WHERE user_id = $1), 0) AS user_total
       FROM usage_events
      WHERE created_at >= $2`,
    [userId, utcDayStart(now).toISOString()],
  );
  return { todaySpendUsd: Number(row?.total ?? 0), userTodaySpendUsd: Number(row?.user_total ?? 0) };
}

export async function checkCaps(userId: string): Promise<CapCheck> {
  const caps = getCapConfig();
  const spend = await getTodaySpend(userId);
  if (spend.todaySpendUsd >= caps.dailyCostCapUsd) {
    logWarn("cap_reached", { reason: "daily_cap", spend: spend.todaySpendUsd, cap: caps.dailyCostCapUsd });
    return {
      allowed: false,
      reason: "daily_cap",
      detail: `Today's estimated spend ($${spend.todaySpendUsd.toFixed(2)}) has reached the daily cap of $${caps.dailyCostCapUsd.toFixed(2)}. Live sessions resume tomorrow (UTC) or after the cap is raised.`,
    };
  }
  if (spend.userTodaySpendUsd >= caps.perUserDailyCostCapUsd) {
    logWarn("cap_reached", { reason: "user_daily_cap", spend: spend.userTodaySpendUsd, cap: caps.perUserDailyCostCapUsd });
    return {
      allowed: false,
      reason: "user_daily_cap",
      detail: `Your estimated spend today ($${spend.userTodaySpendUsd.toFixed(2)}) has reached the per-person daily cap of $${caps.perUserDailyCostCapUsd.toFixed(2)}. Try again tomorrow.`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

interface TokenAggRow {
  model_id?: string;
  input_text_tokens: string | number;
  input_audio_tokens: string | number;
  cached_text_tokens: string | number;
  cached_audio_tokens: string | number;
  output_text_tokens: string | number;
  output_audio_tokens: string | number;
  search_calls: string | number;
  estimated_cost_usd: string | number;
}

interface ConvAggRow {
  model_id?: string;
  sessions: string | number;
  connected_seconds: string | number;
  user_speech_seconds: string | number;
  assistant_speech_seconds: string | number;
}

interface DayRow {
  day: string;
  estimated_cost_usd?: string | number;
  sessions?: string | number;
}

function emptyTotals(): UsageTotals {
  return {
    sessions: 0,
    connectedSeconds: 0,
    userSpeechSeconds: 0,
    assistantSpeechSeconds: 0,
    searchCalls: 0,
    estimatedCostUsd: 0,
    inputTextTokens: 0,
    inputAudioTokens: 0,
    cachedTextTokens: 0,
    cachedAudioTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
  };
}

function applyTokens(t: UsageTotals, row: TokenAggRow): void {
  t.inputTextTokens += Number(row.input_text_tokens);
  t.inputAudioTokens += Number(row.input_audio_tokens);
  t.cachedTextTokens += Number(row.cached_text_tokens);
  t.cachedAudioTokens += Number(row.cached_audio_tokens);
  t.outputTextTokens += Number(row.output_text_tokens);
  t.outputAudioTokens += Number(row.output_audio_tokens);
  t.searchCalls += Number(row.search_calls);
  t.estimatedCostUsd += Number(row.estimated_cost_usd);
}

function applyConversations(t: UsageTotals, row: ConvAggRow): void {
  t.sessions += Number(row.sessions);
  t.connectedSeconds += Number(row.connected_seconds);
  t.userSpeechSeconds += Number(row.user_speech_seconds);
  t.assistantSpeechSeconds += Number(row.assistant_speech_seconds);
}

export const USAGE_NOTE = `Estimates from configured per-token prices (version ${PRICING_VERSION}). Connected minutes are not billable minutes; audio tokens are what is billed.`;

export async function getUsageSummary(userId: string, range: UsageSummary["range"]): Promise<UsageSummary> {
  const now = new Date();
  const since = rangeStart(range, now);
  const sinceIso = since ? since.toISOString() : null;
  // `$2::timestamptz IS NULL` keeps one query shape for all ranges.
  const usageWhere = `WHERE user_id = $1 AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`;
  const convWhere = `WHERE user_id = $1 AND ($2::timestamptz IS NULL OR started_at >= $2::timestamptz)`;
  const params = [userId, sinceIso];

  const [tokenByModel, convByModel, costByDay, sessionsByDay, spend] = await Promise.all([
    query<TokenAggRow>(
      `SELECT model_id,
              COALESCE(SUM(input_text_tokens),0)   AS input_text_tokens,
              COALESCE(SUM(input_audio_tokens),0)  AS input_audio_tokens,
              COALESCE(SUM(cached_text_tokens),0)  AS cached_text_tokens,
              COALESCE(SUM(cached_audio_tokens),0) AS cached_audio_tokens,
              COALESCE(SUM(output_text_tokens),0)  AS output_text_tokens,
              COALESCE(SUM(output_audio_tokens),0) AS output_audio_tokens,
              COALESCE(SUM(search_calls),0)        AS search_calls,
              COALESCE(SUM(estimated_cost_usd),0)  AS estimated_cost_usd
         FROM usage_events ${usageWhere}
        GROUP BY model_id ORDER BY model_id`,
      params,
    ),
    query<ConvAggRow>(
      `SELECT model_id,
              COUNT(*)                                 AS sessions,
              COALESCE(SUM(connected_seconds),0)        AS connected_seconds,
              COALESCE(SUM(user_speech_seconds),0)      AS user_speech_seconds,
              COALESCE(SUM(assistant_speech_seconds),0) AS assistant_speech_seconds
         FROM conversations ${convWhere}
        GROUP BY model_id ORDER BY model_id`,
      params,
    ),
    query<DayRow>(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(estimated_cost_usd),0) AS estimated_cost_usd
         FROM usage_events ${usageWhere}
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query<DayRow>(
      `SELECT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COUNT(*) AS sessions
         FROM conversations ${convWhere}
        GROUP BY 1 ORDER BY 1`,
      params,
    ),
    getTodaySpend(userId, now),
  ]);

  const totals = emptyTotals();
  const byModelMap = new Map<string, UsageTotals>();
  for (const row of tokenByModel) {
    applyTokens(totals, row);
    const t = byModelMap.get(row.model_id!) ?? emptyTotals();
    applyTokens(t, row);
    byModelMap.set(row.model_id!, t);
  }
  for (const row of convByModel) {
    applyConversations(totals, row);
    const t = byModelMap.get(row.model_id!) ?? emptyTotals();
    applyConversations(t, row);
    byModelMap.set(row.model_id!, t);
  }

  const dayMap = new Map<string, { estimatedCostUsd: number; sessions: number }>();
  for (const row of costByDay) {
    const d = dayMap.get(row.day) ?? { estimatedCostUsd: 0, sessions: 0 };
    d.estimatedCostUsd += Number(row.estimated_cost_usd ?? 0);
    dayMap.set(row.day, d);
  }
  for (const row of sessionsByDay) {
    const d = dayMap.get(row.day) ?? { estimatedCostUsd: 0, sessions: 0 };
    d.sessions += Number(row.sessions ?? 0);
    dayMap.set(row.day, d);
  }

  const caps = getCapConfig();
  return {
    range,
    totals: roundTotals(totals),
    byModel: [...byModelMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([modelId, t]) => ({ modelId, totals: roundTotals(t) })),
    byDay: [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({ day, estimatedCostUsd: round6(d.estimatedCostUsd), sessions: d.sessions })),
    caps: {
      dailyCostCapUsd: caps.dailyCostCapUsd,
      perUserDailyCostCapUsd: caps.perUserDailyCostCapUsd,
      maxSessionMinutes: caps.maxSessionMinutes,
      todaySpendUsd: round6(spend.todaySpendUsd),
      userTodaySpendUsd: round6(spend.userTodaySpendUsd),
    },
    pricingVersion: PRICING_VERSION,
    note: USAGE_NOTE,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function roundTotals(t: UsageTotals): UsageTotals {
  return {
    ...t,
    connectedSeconds: Math.round(t.connectedSeconds * 100) / 100,
    userSpeechSeconds: Math.round(t.userSpeechSeconds * 100) / 100,
    assistantSpeechSeconds: Math.round(t.assistantSpeechSeconds * 100) / 100,
    estimatedCostUsd: round6(t.estimatedCostUsd),
  };
}
