import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));

import { GET as exportRoute } from "@/app/api/memory/export/route";
import { DELETE as deleteAccountRoute } from "@/app/api/account/route";
import { GET as listMemoriesRoute, POST as createMemoryRoute } from "@/app/api/memories/route";
import { PATCH as patchMemoryRoute } from "@/app/api/memories/[id]/route";
import { PATCH as patchPreferencesRoute } from "@/app/api/preferences/route";
import { createSession, getCurrentUser, SESSION_COOKIE } from "@/lib/auth/session";
import { query } from "@/lib/database/client";
import { createConversation, appendMessage } from "@/lib/database/conversations";
import { getMemory, insertMemory, listMemoryEvents, listTombstones } from "@/lib/database/memories";
import { findUserById } from "@/lib/database/users";
import { normalizeText } from "@/lib/memory/normalize";
import {
  buildMemoryContext,
  forgetMemory,
  hasConsent,
  recallMemories,
  recordConsent,
  rememberMemory,
  getPreferences,
} from "@/lib/memory/service";
import { listRecentSummaries, storeSummaryMemory } from "@/lib/memory/summaries";
import type { MemoriesResponse, MemoryExport, MemoryResponse } from "@/lib/api/contracts";
import type { User } from "@/lib/types";
import { cookieJar, createUser, ensureSchema, jsonRequest, params, readJson, teardown, truncateAll } from "./helpers";

let user: User;

const lily = { content: "My granddaughter Lily plays the violin", kind: "relationship" as const, category: "family" as const, sensitivity: "normal" as const };

beforeAll(ensureSchema);
beforeEach(async () => {
  await truncateAll();
  cookieJar.reset();
  user = (await createUser({ preferredName: "Margaret" })).user;
});
afterAll(teardown);

describe("consent gating", () => {
  it("refuses to save without memory consent and logs a rejected event", async () => {
    const result = await rememberMemory(user.id, { ...lily, userConfirmed: true });
    expect(result).toEqual({ ok: false, reason: "consent_required" });
    const events = await listMemoryEvents(user.id);
    expect(events.map((e) => e.event)).toContain("rejected");
    expect(await buildMemoryContext(user.id, {})).toEqual({ block: "", memoryIds: [], summaryIds: [], estimatedTokens: 0 });
    expect(await recallMemories(user.id, "violin")).toEqual([]);
  });

  it("consent record alone is not enough when the preference switch is off, and vice versa", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    expect(await hasConsent(user.id, "memory")).toBe(true);
    expect((await getPreferences(user.id)).memoryEnabled).toBe(true); // mirrored
    await query(`UPDATE preferences SET memory_enabled = false WHERE user_id = $1`, [user.id]);
    expect((await rememberMemory(user.id, { ...lily, userConfirmed: true })).ok).toBe(false);
    await query(`UPDATE preferences SET memory_enabled = true WHERE user_id = $1`, [user.id]);
    await recordConsent(user.id, "memory", false, "ui");
    expect((await getPreferences(user.id)).memoryEnabled).toBe(false);
    expect((await rememberMemory(user.id, { ...lily, userConfirmed: true })).ok).toBe(false);
  });

  it("saves with consent: confirmed vs reported, sensitive needs its own consent, duplicates refused", async () => {
    await recordConsent(user.id, "memory", true, "voice", "yes please");
    const confirmed = await rememberMemory(user.id, { ...lily, userConfirmed: true, sourceConversationId: undefined });
    expect(confirmed.ok && confirmed.status).toBe("confirmed");
    const reported = await rememberMemory(user.id, { content: "I usually have soup on Sundays", kind: "fact", category: "routine", sensitivity: "normal", userConfirmed: false });
    expect(reported.ok && reported.status).toBe("reported");

    const dup = await rememberMemory(user.id, { ...lily, content: "my granddaughter lily plays the violin.", userConfirmed: true });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason === "duplicate" && dup.existing?.id).toBe(confirmed.ok ? confirmed.memory.id : null);

    const sensitive = await rememberMemory(user.id, { content: "My doctor changed my blood pressure pills", kind: "fact", category: "health", sensitivity: "normal", userConfirmed: true });
    expect(sensitive).toEqual({ ok: false, reason: "sensitive_consent_required" });
    await recordConsent(user.id, "sensitive_memory", true, "ui");
    const sensitiveOk = await rememberMemory(user.id, { content: "My doctor changed my blood pressure pills", kind: "fact", category: "health", sensitivity: "normal", userConfirmed: true });
    expect(sensitiveOk.ok && sensitiveOk.memory.sensitivity).toBe("sensitive");
  });

  it("revoking memory consent keeps memories but stops injection; onboarding stage advances", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    await rememberMemory(user.id, { ...lily, userConfirmed: true });
    expect((await buildMemoryContext(user.id, {})).memoryIds).toHaveLength(1);
    await recordConsent(user.id, "memory", false, "ui");
    expect((await buildMemoryContext(user.id, {})).block).toBe("");
    const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM memories WHERE user_id = $1 AND deleted_at IS NULL`, [user.id]);
    expect(Number(rows[0].count)).toBe(1);
    const stage = await query<{ onboarding_stage: string }>(`SELECT onboarding_stage FROM profiles WHERE user_id = $1`, [user.id]);
    expect(stage[0].onboarding_stage).toBe("memory_decided");
  });
});

describe("delete -> tombstone -> summary suppression -> no leak", () => {
  it("removes the fact everywhere and refuses to re-learn it", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const saved = await rememberMemory(user.id, { ...lily, userConfirmed: true });
    if (!saved.ok) throw new Error("setup");
    await rememberMemory(user.id, { content: "Tends a vegetable garden and is proud of the tomatoes", kind: "interest", category: "interest", sensitivity: "normal", userConfirmed: true });
    const conversation = await createConversation({ userId: user.id, mode: "demo", modelKey: "full", modelId: "demo-simulated" });
    const summary = await storeSummaryMemory(user.id, {
      content: "Margaret talked about her tomatoes. Her granddaughter Lily plays the violin and has a recital soon. She prefers tea.",
      sourceConversationId: conversation.id,
    });
    expect(summary).not.toBeNull();

    const before = await buildMemoryContext(user.id, {});
    expect(before.block).toMatch(/Lily/);
    expect(before.summaryIds).toEqual([summary!.id]);

    const { deleted } = await forgetMemory(user.id, { memoryId: saved.memory.id });
    expect(deleted.map((m) => m.id)).toEqual([saved.memory.id]);
    expect((await getMemory(user.id, saved.memory.id))).toBeNull();

    const tombstones = await listTombstones(user.id);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].normalized).toBe(normalizeText(lily.content));
    expect(tombstones[0].keywords).toEqual(["granddaughter", "lily", "play", "violin"]);

    const redacted = await getMemory(user.id, summary!.id);
    expect(redacted?.content).toBe("Margaret talked about her tomatoes. She prefers tea.");
    const events = await listMemoryEvents(user.id, summary!.id);
    expect(events.map((e) => e.event)).toContain("suppressed");

    const after = await buildMemoryContext(user.id, {});
    expect(after.block).not.toMatch(/Lily|violin/i);
    expect(after.block).toMatch(/tomatoes/);
    expect(after.memoryIds).not.toContain(saved.memory.id);

    const again = await rememberMemory(user.id, { ...lily, content: "Lily, my granddaughter, plays violin", userConfirmed: true });
    expect(again).toEqual({ ok: false, reason: "tombstoned" });
    expect(await recallMemories(user.id, "Lily violin")).toEqual([]);
  });

  it("soft-deletes a summary that is entirely about the deleted fact", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const saved = await rememberMemory(user.id, { ...lily, userConfirmed: true });
    if (!saved.ok) throw new Error("setup");
    const conversation = await createConversation({ userId: user.id, mode: "demo", modelKey: "full", modelId: "demo-simulated" });
    const summary = await storeSummaryMemory(user.id, { content: "Lily plays the violin.", sourceConversationId: conversation.id });
    await forgetMemory(user.id, { text: "Lily's violin" });
    expect(await getMemory(user.id, summary!.id)).toBeNull();
    expect(await listRecentSummaries(user.id)).toEqual([]);
  });

  it("filters an existing summary through tombstones even if suppression missed it", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const conversation = await createConversation({ userId: user.id, mode: "demo", modelKey: "full", modelId: "demo-simulated" });
    await insertMemory(user.id, {
      kind: "summary", category: "other", status: "summarized", sensitivity: "normal",
      content: "She loves her garden. Granddaughter Lily plays the violin.",
      normalized: normalizeText("She loves her garden. Granddaughter Lily plays the violin."),
      sourceConversationId: conversation.id,
    });
    await query(`INSERT INTO memory_tombstones (user_id, normalized, keywords) VALUES ($1, $2, $3::text[])`, [user.id, "granddaughter lily plays the violin", ["granddaughter", "lily", "play", "violin"]]);
    const summaries = await listRecentSummaries(user.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].content).toBe("She loves her garden.");
  });
});

describe("buildMemoryContext", () => {
  it("never includes inferred memories, respects sensitive consent, and stays within maxTokens", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    for (let i = 0; i < 40; i += 1) {
      await rememberMemory(user.id, { content: `Confirmed fact number ${i} about a hobby that takes some words to describe fully`, kind: "fact", category: "other", sensitivity: "normal", userConfirmed: true, importance: (i % 5) + 1 });
    }
    await rememberMemory(user.id, { content: "Reported: usually has soup on Sundays", kind: "fact", category: "routine", sensitivity: "normal", userConfirmed: false });
    await insertMemory(user.id, { kind: "fact", category: "other", content: "INFERRED guess about the user", normalized: "inferred guess about the user", status: "inferred", sensitivity: "normal" });
    await insertMemory(user.id, { kind: "fact", category: "health", content: "SENSITIVE health note", normalized: "sensitive health note", status: "confirmed", sensitivity: "sensitive" });

    const small = await buildMemoryContext(user.id, { maxTokens: 200 });
    expect(small.estimatedTokens).toBeLessThanOrEqual(200);
    expect(small.block).not.toMatch(/INFERRED|SENSITIVE/);
    expect(small.memoryIds.length).toBeGreaterThan(0);
    expect(small.memoryIds.length).toBeLessThan(40);

    const large = await buildMemoryContext(user.id, { maxTokens: 4000 });
    expect(large.estimatedTokens).toBeLessThanOrEqual(4000);
    expect(large.block).toMatch(/Facts the user asked you to remember \(confirmed\):/);
    expect(large.block).toMatch(/Things the user mentioned \(not confirmed/);
    expect(large.block).not.toMatch(/INFERRED|SENSITIVE/);
    expect(large.memoryIds).toHaveLength(41);

    await recordConsent(user.id, "sensitive_memory", true, "ui");
    expect((await buildMemoryContext(user.id, { maxTokens: 4000 })).block).toMatch(/SENSITIVE health note/);
  });

  it("includes the recent transcript when continuing a conversation", async () => {
    await recordConsent(user.id, "memory", true, "ui");
    const conversation = await createConversation({ userId: user.id, mode: "demo", modelKey: "full", modelId: "demo-simulated" });
    for (let i = 0; i < 25; i += 1) {
      await appendMessage({ userId: user.id, conversationId: conversation.id, role: i % 2 ? "assistant" : "user", content: `line ${i}` });
    }
    const context = await buildMemoryContext(user.id, { continueConversationId: conversation.id });
    expect(context.block).toMatch(/This conversation so far \(you are continuing it after a model switch\):/);
    expect(context.block).toMatch(/User: line 24/);
    expect(context.block).not.toMatch(/line 4\b/); // only the last ~20
    const other = (await createUser()).user;
    expect((await buildMemoryContext(other.id, { continueConversationId: conversation.id })).block).toBe("");
  });
});

describe("memory routes", () => {
  it("POST is 403 without consent, then creates; PATCH corrects/confirms and refuses other status changes", async () => {
    await createSession(user);
    const denied = await createMemoryRoute(jsonRequest("/api/memories", "POST", { content: "I like tea" }));
    expect(denied.status).toBe(403);
    expect((await readJson<{ error: { code: string } }>(denied)).error.code).toBe("consent_required");

    const prefs = await patchPreferencesRoute(jsonRequest("/api/preferences", "PATCH", { memoryEnabled: true }));
    expect(prefs.status).toBe(200);
    expect(await hasConsent(user.id, "memory")).toBe(true);

    const created = await createMemoryRoute(jsonRequest("/api/memories", "POST", { content: "I like tea", kind: "preference", category: "preference" }));
    expect(created.status).toBe(201);
    const { memory } = await readJson<MemoryResponse>(created);
    expect(memory.status).toBe("confirmed");

    const inferred = await insertMemory(user.id, { kind: "fact", category: "other", content: "Maybe likes jazz", normalized: "maybe likes jazz", status: "inferred", sensitivity: "normal" });
    const corrected = await patchMemoryRoute(jsonRequest(`/api/memories/${inferred.id}`, "PATCH", { content: "Likes jazz on Sundays" }), params(inferred.id));
    expect((await readJson<MemoryResponse>(corrected)).memory).toMatchObject({ content: "Likes jazz on Sundays", status: "inferred" });
    const confirmed = await patchMemoryRoute(jsonRequest(`/api/memories/${inferred.id}`, "PATCH", { confirm: true }), params(inferred.id));
    expect((await readJson<MemoryResponse>(confirmed)).memory.status).toBe("confirmed");
    const refused = await patchMemoryRoute(jsonRequest(`/api/memories/${inferred.id}`, "PATCH", { status: "reported" }), params(inferred.id));
    expect(refused.status).toBe(400);
    const events = (await listMemoryEvents(user.id, inferred.id)).map((e) => e.event);
    expect(events).toContain("corrected");
    expect(events).toContain("confirmed");

    const list = await readJson<MemoriesResponse>(await listMemoriesRoute());
    expect(list.memories.map((m) => m.id).sort()).toEqual([memory.id, inferred.id].sort());
  });

  it("export contains all of the user's data and only theirs; account delete cascades", async () => {
    const other = (await createUser({ preferredName: "Other" })).user;
    await recordConsent(other.id, "memory", true, "ui");
    await rememberMemory(other.id, { content: "Other person's secret hobby", kind: "fact", category: "other", sensitivity: "normal", userConfirmed: true });

    await recordConsent(user.id, "memory", true, "voice", "sure");
    const saved = await rememberMemory(user.id, { ...lily, userConfirmed: true });
    const conversation = await createConversation({ userId: user.id, mode: "demo", modelKey: "full", modelId: "demo-simulated" });
    await appendMessage({ userId: user.id, conversationId: conversation.id, role: "user", content: "hello there" });
    await forgetMemory(user.id, { text: "nothing matches this" });

    await createSession(user);
    const response = await exportRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="companion-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = (await response.json()) as MemoryExport;
    expect(data.user.id).toBe(user.id);
    expect(data.profile.preferredName).toBe("Margaret");
    expect(data.consents.map((c) => c.evidence)).toContain("sure");
    expect(data.memories.map((m) => m.id)).toEqual([saved.ok ? saved.memory.id : ""]);
    expect(JSON.stringify(data)).not.toMatch(/Other person/);
    expect(data.conversations).toHaveLength(1);
    expect(data.conversations[0].messages[0].content).toBe("hello there");

    const del = await deleteAccountRoute();
    expect(del.status).toBe(200);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
    expect(await getCurrentUser()).toBeNull();
    expect(await findUserById(user.id)).toBeNull();
    for (const table of ["profiles", "preferences", "consent_records", "memories", "memory_events", "memory_tombstones", "conversations", "conversation_messages"]) {
      const rows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE user_id = $1`, [user.id]);
      expect(Number(rows[0].count), table).toBe(0);
    }
    const otherRows = await query<{ count: string }>(`SELECT count(*)::text AS count FROM memories WHERE user_id = $1`, [other.id]);
    expect(Number(otherRows[0].count)).toBe(1);
  });
});
