/**
 * Usage telemetry against the REAL tracker and test database: transcription cost
 * from user speech seconds, and spend surviving account deletion (migration 002).
 * Starts from a dropped schema so both migrations are exercised on a fresh database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TRANSCRIPTION_MODEL, TRANSCRIPTION_PRICE_PER_MINUTE } from "@/lib/ai/models";
import { deleteAccount } from "@/lib/auth/service";
import { finishConversation, recordConversationEvents, startConversation } from "@/lib/conversations/service";
import { query, queryOne } from "@/lib/database/client";
import { createConversation } from "@/lib/database/conversations";
import { resetDatabase, runMigrations } from "@/lib/database/migrate";
import { findUserById } from "@/lib/database/users";
import { getTodaySpend, getUsageSummary, recordUsage } from "@/lib/usage/tracker";
import type { User } from "@/lib/types";
import { createUser, ensureSchema, teardown, truncateAll } from "./helpers";

interface UsageRow {
  user_id: string | null;
  model_id: string;
  kind: string;
  duration_seconds: string;
  estimated_cost_usd: string;
}

let user: User;

beforeAll(async () => {
  await ensureSchema(); // guards against a non-test DATABASE_URL before anything is dropped
  await resetDatabase();
  const ran = await runMigrations();
  // Every migration file runs on a fresh database, in lexical order; 001/002 are the ones this file exercises.
  expect(ran.slice(0, 2)).toEqual(["001_init.sql", "002_usage_events_keep_on_delete.sql"]);
  expect(ran).toEqual([...ran].sort());
  expect(ran).toContain("004_personality_profiles.sql");
  expect(await runMigrations()).toEqual([]); // idempotent on a database that already has them all
});
beforeEach(async () => {
  await truncateAll();
  user = (await createUser({ preferredName: "Margaret" })).user;
});
afterAll(teardown);

describe("migration 002", () => {
  it("makes usage_events.user_id nullable with ON DELETE SET NULL", async () => {
    const column = await queryOne<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'usage_events' AND column_name = 'user_id'`,
    );
    expect(column?.is_nullable).toBe("YES");
    const fk = await query<{ conname: string; confdeltype: string }>(
      `SELECT c.conname, c.confdeltype FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'usage_events'::regclass AND c.contype = 'f' AND a.attname = 'user_id'`,
    );
    expect(fk).toEqual([{ conname: "usage_events_user_id_fkey", confdeltype: "n" }]);
  });
});

describe("transcription cost", () => {
  it("records a transcription usage event from the user's speech seconds on a live conversation", async () => {
    const live = await createConversation({ userId: user.id, mode: "live", modelKey: "full", modelId: "gpt-realtime-2.1" });
    const result = await recordConversationEvents(user.id, live.id, [
      { type: "speech", speaker: "user", seconds: 30 },
      { type: "speech", speaker: "assistant", seconds: 12 },
      { type: "speech", speaker: "user", seconds: 0 },
    ]);
    expect(result).toEqual({ received: 3, stored: 3 });

    const rows = await query<UsageRow>(
      `SELECT user_id, model_id, kind, duration_seconds::text, estimated_cost_usd::text FROM usage_events WHERE conversation_id = $1 ORDER BY created_at`,
      [live.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: user.id, model_id: DEFAULT_TRANSCRIPTION_MODEL, kind: "transcription" });
    expect(Number(rows[0].duration_seconds)).toBe(30);
    expect(Number(rows[0].estimated_cost_usd)).toBeCloseTo((30 / 60) * TRANSCRIPTION_PRICE_PER_MINUTE[DEFAULT_TRANSCRIPTION_MODEL], 6);
    expect(Number(rows[0].estimated_cost_usd)).toBeCloseTo(0.0085, 6);

    const summary = await getUsageSummary(user.id, "today");
    expect(summary.totals.estimatedCostUsd).toBeCloseTo(0.0085, 6);
    expect(summary.byModel.map((m) => m.modelId)).toContain(DEFAULT_TRANSCRIPTION_MODEL);
  });

  it("demo conversations never record transcription cost", async () => {
    const demo = await startConversation(user, { mode: "demo", modelKey: "full" });
    await recordConversationEvents(user.id, demo.id, [{ type: "speech", speaker: "user", seconds: 45 }]);
    const count = await queryOne<{ count: string }>(`SELECT count(*)::text AS count FROM usage_events WHERE user_id = $1`, [user.id]);
    expect(Number(count?.count)).toBe(0);
    expect((await getTodaySpend(user.id)).userTodaySpendUsd).toBe(0);
  });
});

describe("account deletion keeps spend in the global daily cap", () => {
  it("usage_events survive deleteAccount with user_id NULL; per-user figures vanish, the global sum does not", async () => {
    const other = (await createUser({ preferredName: "Other" })).user;
    const live = await createConversation({ userId: user.id, mode: "live", modelKey: "full", modelId: "gpt-realtime-2.1" });
    const { estimatedCostUsd } = await recordUsage({ userId: user.id, conversationId: live.id, modelId: "gpt-realtime-2.1", kind: "realtime_response", inputAudioTokens: 6000, outputAudioTokens: 12000 });
    expect(estimatedCostUsd).toBeCloseTo(0.96, 6);
    await finishConversation(user.id, live.id);

    const before = await getTodaySpend(other.id);
    expect(before.todaySpendUsd).toBeCloseTo(0.96, 6);
    expect(before.userTodaySpendUsd).toBe(0);

    expect(await deleteAccount(user.id)).toBe(true);
    expect(await findUserById(user.id)).toBeNull();
    for (const table of ["profiles", "preferences", "conversations", "memories"]) {
      const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE user_id = $1`, [user.id]);
      expect(Number(rows[0].count), table).toBe(0);
    }

    const orphaned = await query<UsageRow>(`SELECT user_id, model_id, kind, duration_seconds::text, estimated_cost_usd::text FROM usage_events`);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].user_id).toBeNull();
    expect(Number(orphaned[0].estimated_cost_usd)).toBeCloseTo(0.96, 6);

    const after = await getTodaySpend(other.id);
    expect(after.todaySpendUsd).toBeCloseTo(0.96, 6); // still counts toward the global cap
    expect(after.userTodaySpendUsd).toBe(0);
    const summary = await getUsageSummary(other.id, "today");
    expect(summary.totals.estimatedCostUsd).toBe(0); // per-user views never show someone else's spend
    expect(summary.caps.todaySpendUsd).toBeCloseTo(0.96, 6);
  });
});
