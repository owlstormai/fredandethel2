import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GREETING_INPUT, maybeQuip, runDemoTurn, type DemoState } from "@/lib/ai/adapters/demoBrain";
import { ensureDemoUser } from "@/lib/auth/demo";
import { startConversation } from "@/lib/conversations/service";
import { getConversation, listMessages } from "@/lib/database/conversations";
import { listMemories, listMemoryEvents, listTombstones } from "@/lib/database/memories";
import { hashText } from "@/lib/memory/normalize";
import { getPreferences, getProfile, hasConsent, recordConsent, setHumorLevel } from "@/lib/memory/service";
import type { User } from "@/lib/types";
import { createUser, ensureSchema, teardown, truncateAll } from "./helpers";

beforeAll(ensureSchema);
beforeEach(truncateAll);
afterAll(teardown);

async function conversationFor(user: User) {
  return (await startConversation(user, { mode: "demo", modelKey: "full" })).id;
}

function demoState(metadata: Record<string, unknown>): DemoState {
  return metadata.demo as DemoState;
}

describe("onboarding flow (new account, no consent)", () => {
  it("greets by companion name, learns the name, asks an interest, asks for memory opt-in, records voice consent", async () => {
    const { user } = await createUser();
    const conversationId = await conversationFor(user);

    const greeting = await runDemoTurn(user.id, conversationId, GREETING_INPUT);
    expect(greeting.simulated).toBe(true);
    expect(greeting.reply).toMatch(/I'm Ethel/);
    expect(greeting.reply).toMatch(/what would you like me to call you\?/i);
    expect(demoState((await getConversation(user.id, conversationId))!.metadata).awaiting).toBe("name");

    const named = await runDemoTurn(user.id, conversationId, "You can call me Peg");
    expect(named.toolCalls).toEqual([{ name: "set_preferred_name", arguments: { name: "Peg" }, output: JSON.stringify({ ok: true, name: "Peg" }) }]);
    expect(named.uiActions).toEqual([{ type: "name_set", name: "Peg" }]);
    expect(named.reply).toMatch(/^Peg — lovely/);
    expect(named.reply).toMatch(/hobby/);
    expect((await getProfile(user.id))).toMatchObject({ preferredName: "Peg", onboardingStage: "named" });

    const interest = await runDemoTurn(user.id, conversationId, "I love working in my garden");
    expect(interest.reply).toMatch(/Would you like me to remember things like that between our chats\? You can say no, and you can always change your mind\.$/);
    expect((await getProfile(user.id)).onboardingStage).toBe("interests");
    expect(await hasConsent(user.id, "memory")).toBe(false);

    const yes = await runDemoTurn(user.id, conversationId, "Yes please");
    expect(yes.toolCalls[0]).toMatchObject({ name: "record_consent", arguments: { scope: "memory", granted: true, source: "voice", evidence: "Yes please" } });
    expect(yes.uiActions.find((a) => a.type === "consent_prompt")).toBeUndefined();
    expect(await hasConsent(user.id, "memory")).toBe(true);
    expect((await getPreferences(user.id)).memoryEnabled).toBe(true);
    expect((await getProfile(user.id)).onboardingStage).toBe("memory_decided");
    // The interest they mentioned is kept as "reported", never "confirmed".
    const memories = await listMemories(user.id);
    expect(memories.map((m) => [m.content, m.status])).toEqual([["Enjoys working in their garden", "reported"]]);
    expect(yes.reply).toMatch(/made a note that you mentioned enjoys working in their garden/i);

    const messages = await listMessages(user.id, conversationId);
    expect(messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["You can call me Peg", "I love working in my garden", "Yes please"]);
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(4);
    expect(messages.filter((m) => m.role === "tool").map((m) => m.toolName)).toEqual(["set_preferred_name", "record_consent", "remember"]);
  });

  it("records a spoken 'no' as declined consent and keeps memory off", async () => {
    const { user } = await createUser({ preferredName: "Walt" });
    const conversationId = await conversationFor(user);
    const greeting = await runDemoTurn(user.id, conversationId, GREETING_INPUT);
    expect(greeting.reply).toMatch(/Hello, Walt — I'm Ethel/);
    await runDemoTurn(user.id, conversationId, "I like old jazz records");
    const no = await runDemoTurn(user.id, conversationId, "Not now, thanks");
    expect(no.toolCalls[0]).toMatchObject({ name: "record_consent", arguments: { scope: "memory", granted: false } });
    expect(no.reply).toMatch(/each time we talk starts fresh/);
    expect(await hasConsent(user.id, "memory")).toBe(false);
    expect(await listMemories(user.id)).toEqual([]);
    expect((await getProfile(user.id)).onboardingStage).toBe("memory_decided");
  });

  it("asks for consent when told to remember something before opting in, then saves it on yes", async () => {
    const { user } = await createUser({ preferredName: "Peg" });
    await recordConsent(user.id, "memory", false, "ui"); // decided: no
    const conversationId = await conversationFor(user);
    const attempt = await runDemoTurn(user.id, conversationId, "Remember that I take the bus to the library on Tuesdays");
    expect(attempt.toolCalls).toEqual([]);
    expect(attempt.uiActions).toEqual([{ type: "consent_prompt", scope: "memory" }]);
    expect(attempt.reply).toMatch(/permission/);
    const yes = await runDemoTurn(user.id, conversationId, "yes, go ahead");
    expect(yes.toolCalls.map((t) => t.name)).toEqual(["record_consent", "remember"]);
    const saved = yes.uiActions.find((a) => a.type === "memory_saved");
    expect(saved).toMatchObject({ type: "memory_saved", content: "I take the bus to the library on Tuesdays" });
    expect((await listMemories(user.id))[0]).toMatchObject({ status: "confirmed", category: "other" });
  });

  it("keeps health, money and grief behind a separate consent", async () => {
    const user = (await ensureDemoUser("margaret"))!; // memory consent granted, sensitive not
    const conversationId = await conversationFor(user);
    const attempt = await runDemoTurn(user.id, conversationId, "Remember that I take my blood pressure pills at eight");
    expect(attempt.toolCalls[0]).toMatchObject({ name: "remember", arguments: { category: "health", sensitivity: "sensitive" } });
    expect(attempt.toolCalls[0].output).toContain("sensitive_consent_required");
    expect(attempt.uiActions).toEqual([{ type: "consent_prompt", scope: "sensitive_memory" }]);
    expect(attempt.reply).toMatch(/personal matter/);
    expect((await listMemories(user.id)).some((m) => /pills/.test(m.content))).toBe(false);

    const yes = await runDemoTurn(user.id, conversationId, "Yes, that's fine");
    expect(yes.toolCalls.map((t) => t.name)).toEqual(["record_consent", "remember"]);
    expect(yes.toolCalls[0].arguments).toMatchObject({ scope: "sensitive_memory", granted: true });
    expect(yes.uiActions).toEqual([expect.objectContaining({ type: "memory_saved" })]);
    expect((await listMemories(user.id)).find((m) => /pills/.test(m.content))).toMatchObject({ sensitivity: "sensitive", status: "confirmed", category: "health" });
    expect(await hasConsent(user.id, "sensitive_memory")).toBe(true);
  });
});

describe("remember / forget / recall with a consented demo profile", () => {
  it("round-trips a fact, lists it honestly, forgets it with a tombstone; an explicit re-add supersedes the tombstone", async () => {
    const user = (await ensureDemoUser("margaret"))!;
    const conversationId = await conversationFor(user);

    const greeting = await runDemoTurn(user.id, conversationId, GREETING_INPUT);
    expect(greeting.reply).toMatch(/Margaret/);
    expect(greeting.reply).toMatch(/Ethel/);
    expect(greeting.reply).toMatch(/I remember you mentioned/);
    expect(greeting.toolCalls.map((t) => t.name)).toEqual(["recall_memories"]);

    const saved = await runDemoTurn(user.id, conversationId, "Please remember that my neighbor Rosa brings me the newspaper every morning");
    expect(saved.toolCalls[0]).toMatchObject({ name: "remember", arguments: { userConfirmed: true, category: "friends", kind: "relationship" } });
    const saveAction = saved.uiActions.find((a) => a.type === "memory_saved") as { memoryId: string; content: string };
    expect(saveAction.content).toBe("My neighbor Rosa brings me the newspaper every morning");
    expect(saved.reply).toMatch(/your neighbor Rosa brings you the newspaper every morning/);

    const dup = await runDemoTurn(user.id, conversationId, "remember my neighbor Rosa brings me the newspaper every morning");
    expect(dup.reply).toMatch(/already have that one/);

    const recall = await runDemoTurn(user.id, conversationId, "What do you remember about me?");
    expect(recall.toolCalls[0].name).toBe("recall_memories");
    expect(recall.reply).toMatch(/You asked me to remember that/);
    expect(recall.reply).toMatch(/Rosa/);
    expect(recall.reply).toMatch(/Lily/);

    const forget = await runDemoTurn(user.id, conversationId, "Forget about Rosa and the newspaper");
    expect(forget.toolCalls[0].name).toBe("forget");
    expect(forget.uiActions).toEqual([{ type: "memory_deleted", memoryId: saveAction.memoryId }]);
    expect(forget.reply).toMatch(/I've forgotten that/);
    expect((await listTombstones(user.id)).map((t) => t.keywords)).toEqual([["neighbor", "rosa", "bring", "newspaper", "morning"]]);
    expect((await listMemories(user.id)).some((m) => /Rosa/.test(m.content))).toBe(false);

    // A spoken "remember that ..." is an explicit, confirmed save: it supersedes the
    // earlier "forget" (the tombstone is retired and the override is said out loud).
    const again = await runDemoTurn(user.id, conversationId, "Remember that my neighbor Rosa brings the newspaper");
    expect(again.toolCalls[0]).toMatchObject({ name: "remember", arguments: { userConfirmed: true } });
    expect(again.toolCalls[0].output).toContain('"retiredTombstones":1');
    expect(again.reply).toMatch(/your neighbor Rosa brings the newspaper/);
    expect(again.reply).toMatch(/asked me to forget something like this before/);
    expect(await listTombstones(user.id)).toEqual([]);
    expect((await listMemories(user.id)).some((m) => /Rosa/.test(m.content) && m.status === "confirmed")).toBe(true);
    expect((await listMemoryEvents(user.id)).map((e) => e.event)).toContain("corrected");

    const nothing = await runDemoTurn(user.id, conversationId, "forget about my pet giraffe");
    expect(nothing.reply).toMatch(/nothing to forget/);
  });

  it("says plainly that nothing is saved when memory is off", async () => {
    const { user } = await createUser({ preferredName: "Peg" });
    await recordConsent(user.id, "memory", false, "ui");
    const conversationId = await conversationFor(user);
    const recall = await runDemoTurn(user.id, conversationId, "what do you remember?");
    expect(recall.toolCalls).toEqual([]);
    expect(recall.reply).toMatch(/memory is turned off/);
  });
});

describe("humor", () => {
  it("'less joking' steps humor down and 'more jokes' back up, with ui actions", async () => {
    const user = (await ensureDemoUser("walter"))!; // playful
    const conversationId = await conversationFor(user);
    const less = await runDemoTurn(user.id, conversationId, "A little less joking, please");
    expect(less.toolCalls).toEqual([{ name: "set_humor_level", arguments: { level: "gentle" }, output: JSON.stringify({ ok: true, level: "gentle" }) }]);
    expect(less.uiActions).toEqual([{ type: "humor_changed", level: "gentle" }]);
    expect((await getPreferences(user.id)).humorLevel).toBe("gentle");
    const stop = await runDemoTurn(user.id, conversationId, "stop joking");
    expect(stop.uiActions).toEqual([{ type: "humor_changed", level: "off" }]);
    expect(stop.reply).toMatch(/no more jokes/i);
    const more = await runDemoTurn(user.id, conversationId, "ok, more jokes");
    expect(more.uiActions).toEqual([{ type: "humor_changed", level: "gentle" }]);
  });

  it("drops humor for the rest of the conversation after a serious topic", async () => {
    const user = (await ensureDemoUser("walter"))!;
    await setHumorLevel(user.id, "playful");
    const conversationId = await conversationFor(user);
    // Find a light text that would carry a quip at playful level.
    const candidates = ["We put on an old jazz record and danced in the kitchen", "I did the crossword in pen this morning", "The tomatoes are finally coming in", "I baked an apple pie for the neighbors"];
    const light = candidates.find((t) => maybeQuip(t, "playful", hashText(t)) !== "")!;
    const quip = maybeQuip(light, "playful", hashText(light));
    expect(quip).not.toBe("");

    const fresh = await conversationFor(user);
    const cheerful = await runDemoTurn(user.id, fresh, light);
    expect(cheerful.reply).toContain(quip);

    const serious = await runDemoTurn(user.id, conversationId, "My sister passed away last week and I can't stop thinking about it");
    expect(serious.reply).toMatch(/I'm so sorry/);
    expect(serious.reply).toMatch(/friend|family/);
    expect(serious.reply).toMatch(/\?/);
    // Channel 2 (from the words): the loss is noticed and shows in the transcript as observe_tone; no other tool runs.
    expect(serious.toolCalls.map((t) => t.name)).toEqual(["observe_tone"]);
    expect(serious.toolCalls[0].arguments).toMatchObject({ tone: "upset", serious: true });
    expect(demoState((await getConversation(user.id, conversationId))!.metadata).serious).toBe(true);

    const later = await runDemoTurn(user.id, conversationId, light);
    expect(later.reply).not.toContain(quip);
    expect(later.reply).toMatch(/\?/);
  });

  it("gives a calm emergency instruction and a crisis line, never clinical advice", async () => {
    const user = (await ensureDemoUser("margaret"))!;
    const conversationId = await conversationFor(user);
    const chest = await runDemoTurn(user.id, conversationId, "I have a terrible chest pain right now");
    expect(chest.reply).toMatch(/call 911/);
    expect(chest.reply).not.toMatch(/aspirin|dose|mg/i);
    const crisis = await runDemoTurn(user.id, conversationId, "some days I just want to end it all");
    expect(crisis.reply).toMatch(/988/);
  });
});

describe("disagreement and reflective templates", () => {
  it("gently disagrees with a common falsehood and moves on with a question", async () => {
    const user = (await ensureDemoUser("margaret"))!;
    const conversationId = await conversationFor(user);
    const reply = (await runDemoTurn(user.id, conversationId, "I read that you can see the Great Wall of China from space")).reply;
    expect(reply).toMatch(/push back|disagree|Actually/i);
    expect(reply).toMatch(/Great Wall/);
    expect(reply).toMatch(/\?$/);
  });

  it("produces the same reply for the same input (deterministic templates) and varies across inputs", async () => {
    const { user } = await createUser({ preferredName: "Peg" });
    await recordConsent(user.id, "memory", false, "ui");
    const a = await conversationFor(user);
    const b = await conversationFor(user);
    const text = "I spent the whole morning in my garden pulling weeds";
    const first = await runDemoTurn(user.id, a, text);
    const second = await runDemoTurn(user.id, b, text);
    expect(first.reply).toBe(second.reply);
    expect(first.reply).toMatch(/you spent the whole morning in your garden pulling weeds|garden/);
    expect(first.reply).toMatch(/\?/);

    const replies = new Set<string>();
    for (const t of ["We drove out to the lake on Sunday", "My son called from Denver last night", "The cat knocked a vase off the shelf", "I finished a thousand-piece puzzle"]) {
      replies.add((await runDemoTurn(user.id, a, t)).reply);
    }
    expect(replies.size).toBeGreaterThanOrEqual(3);
  });

  it("weaves in a relevant saved memory instead of inventing one", async () => {
    const user = (await ensureDemoUser("margaret"))!;
    const conversationId = await conversationFor(user);
    // Try a few phrasings; the callback fires on even hashes when a memory overlaps.
    const texts = ["Lily practiced her violin for an hour today", "Lily's violin practice went well today", "We listened to Lily play her violin tonight", "Lily played violin for us after dinner"];
    let callbackSeen = false;
    for (const t of texts) {
      const r = await runDemoTurn(user.id, conversationId, t);
      if (/That reminds me — you told me/.test(r.reply)) {
        callbackSeen = true;
        expect(r.reply).toMatch(/Lily/);
        expect(r.toolCalls.map((c) => c.name)).toEqual(["recall_memories"]);
      }
    }
    expect(callbackSeen).toBe(true);

    const walter = (await ensureDemoUser("walter"))!;
    const wc = await conversationFor(walter);
    const r = await runDemoTurn(walter.id, wc, "Lily practiced her violin for an hour today");
    expect(r.reply).not.toMatch(/That reminds me/); // Walter has no Lily memory
  });

  it("refuses non-demo or foreign conversations", async () => {
    const { user } = await createUser();
    const other = (await createUser()).user;
    const conversationId = await conversationFor(user);
    await expect(runDemoTurn(other.id, conversationId, "hello")).rejects.toMatchObject({ status: 404 });
  });
});
