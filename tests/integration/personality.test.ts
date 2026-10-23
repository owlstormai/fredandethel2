/**
 * Conversation-style profile + three-channel listening, against the real test
 * database. Demo conversations only (no paid calls): the heuristic path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));

import { GET as exportRoute } from "@/app/api/memory/export/route";
import { DELETE as resetStyleRoute, GET as styleRoute } from "@/app/api/profile/style/route";
import { GREETING_INPUT, maybeQuip, runDemoTurn, STYLE_HUMOR_THRESHOLD, STYLE_VERBOSITY_THRESHOLD, type DemoState } from "@/lib/ai/adapters/demoBrain";
import type { MemoryExport, StyleProfileResponse } from "@/lib/api/contracts";
import { ensureDemoUser } from "@/lib/auth/demo";
import { createSession } from "@/lib/auth/session";
import { finishConversation, startConversation } from "@/lib/conversations/service";
import { getConversation, listMessages } from "@/lib/database/conversations";
import { listMemoryEvents } from "@/lib/database/memories";
import { getPersonalityProfile, upsertPersonalityProfile } from "@/lib/database/personality";
import { countToneEvents, listRecentToneEvents } from "@/lib/database/tone";
import { hashText } from "@/lib/memory/normalize";
import { analyzeStyleHeuristic } from "@/lib/memory/personality";
import { recordToneObservation, updatePersonalityFromConversation } from "@/lib/memory/personalityService";
import { recordConsent, setHumorLevel, updateProfile } from "@/lib/memory/service";
import type { User } from "@/lib/types";
import { cookieJar, createUser, ensureSchema, readJson, teardown, truncateAll } from "./helpers";

const JOKEY = [
  "Haha, well my garden is mostly weeds with ambitions, but the tomatoes don't know that yet!",
  "I told my grandson I'm a fossil and he asked which museum I'm in. Kidding — he's a sweet kid, haha.",
  "Baseball tonight! The Guardians will break my heart again, but that's the fun of it, isn't it?",
  "No pun intended, but my knees are the real weeds in this garden. Lol.",
  "I love a good crossword — seven letters for 'stubborn old man'? Me, haha!",
  "The tomatoes are coming in, the garden is a jungle, and I'm the only explorer. Ha!",
];
const TERSE = [
  "Good afternoon. I would like the weather forecast for tomorrow, please.",
  "Thank you. That will be all for now.",
  "No. That is not correct. The game is on Thursday.",
  "Please tell me the time of the appointment.",
  "I see. Thank you kindly.",
  "Regarding the forecast, is rain expected on Friday?",
];

beforeAll(ensureSchema);
beforeEach(async () => {
  await truncateAll();
  cookieJar.reset();
});
afterAll(teardown);

async function talkDemo(user: User, lines: string[]) {
  const conversation = await startConversation(user, { mode: "demo", modelKey: "full" });
  await runDemoTurn(user.id, conversation.id, GREETING_INPUT);
  for (const line of lines) await runDemoTurn(user.id, conversation.id, line);
  return conversation.id;
}

/** A regular (non-demo) account that has finished onboarding; memory consent as given. */
async function onboardedUser(memory: boolean) {
  const { user } = await createUser({ preferredName: "Peg" });
  await recordConsent(user.id, "memory", memory, "ui");
  await updateProfile(user.id, { onboardingStage: "complete" });
  return user;
}

describe("profile from a demo conversation (heuristic, words only)", () => {
  it("ending a jokey conversation creates an inferred profile with humor > 0.5, evidence counts, tone frequencies and a 'how it felt' line", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    const conversationId = await talkDemo(walter, JOKEY);

    const ended = await finishConversation(walter.id, conversationId);
    expect(ended.conversation.status).toBe("ended");
    expect(ended.styleUpdated).toBe(true);
    expect(ended.feel).toBeDefined();
    expect(ended.feel!.line).toMatch(/^You sounded /);
    expect(ended.feel!.dominantTone).toBe("humor");

    const profile = await getPersonalityProfile(walter.id);
    expect(profile).not.toBeNull();
    expect(profile!.traits.scores.humor).toBeGreaterThan(0.5);
    expect(profile!.evidenceConversations).toBe(1);
    expect(profile!.evidenceMessages).toBe(JOKEY.length);
    expect(profile!.source).toBe("heuristic");
    expect(profile!.summary).toBeNull(); // no model in demo mode
    expect(profile!.traits.topics.join(" ")).toMatch(/garden|tomato/);
    // One lexical tone event per user turn, all heuristic, folded into the profile.
    expect(await countToneEvents(walter.id)).toBe(JOKEY.length);
    const events = await listRecentToneEvents(walter.id);
    expect(events.every((e) => e.source === "heuristic")).toBe(true);
    expect(events.every((e) => e.messageId !== null && e.conversationId === conversationId)).toBe(true);
    expect(profile!.traits.tones?.humor).toBeGreaterThan(0.5);
    expect(profile!.traits.intents?.joking).toBeGreaterThan(0.5);
    // The transcript carries observe_tone entries for the notable (jokey) turns.
    const tools = (await listMessages(walter.id, conversationId)).filter((m) => m.role === "tool" && m.toolName === "observe_tone");
    expect(tools.length).toBeGreaterThanOrEqual(4);
    // Logged as a memory event of kind "personality".
    const created = (await listMemoryEvents(walter.id)).find((e) => e.event === "created" && e.payload.kind === "personality");
    expect(created?.payload).toMatchObject({ conversationId, source: "heuristic", messages: JOKEY.length });

    // Idempotent end: no second update.
    const again = await finishConversation(walter.id, conversationId);
    expect(again.styleUpdated).toBe(false);
    expect((await getPersonalityProfile(walter.id))!.evidenceConversations).toBe(1);

    // The API describes it in plain words and lists the recent observations without cues.
    await createSession(walter);
    const body = await readJson<StyleProfileResponse>(await styleRoute());
    expect(body.profile?.userId).toBe(walter.id);
    expect(body.description.find((r) => r.label === "Humor")?.value).toMatch(/joke often/);
    expect(body.recentTones).toHaveLength(JOKEY.length);
    expect(JSON.stringify(body.recentTones)).not.toMatch(/cue/);
    expect(body.recentTones.filter((t) => t.tone === "humor" && t.intent === "joking").length).toBeGreaterThanOrEqual(3);
    expect(body.recentTones.every((t) => typeof t.createdAt === "string" && t.intensity >= 0 && t.intensity <= 1)).toBe(true);
  });

  it("requires memory consent: no profile, no tone events, no feel", async () => {
    const user = await onboardedUser(false);
    const conversationId = await talkDemo(user, JOKEY.slice(0, 4));
    const ended = await finishConversation(user.id, conversationId);
    expect(ended.styleUpdated).toBe(false);
    expect(ended.feel).toBeUndefined();
    expect(await getPersonalityProfile(user.id)).toBeNull();
    expect(await countToneEvents(user.id)).toBe(0);
    // The conversation itself still carries the in-conversation observation.
    const tools = (await listMessages(user.id, conversationId)).filter((m) => m.role === "tool" && m.toolName === "observe_tone");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].content).toContain('"stored":false');
    // Direct service calls refuse too.
    expect(await recordToneObservation(user.id, { conversationId, tone: "joy", intensity: 0.7, intent: "small_talk", cue: null, source: "model" })).toBeNull();
    expect(await updatePersonalityFromConversation(user.id, conversationId, await listMessages(user.id, conversationId), { useModel: false })).toBeNull();
    await recordConsent(user.id, "memory", true, "ui");
    expect(await recordToneObservation(user.id, { conversationId, tone: "joy", intensity: 0.7, intent: "small_talk", cue: null, source: "model" })).toMatchObject({ tone: "joy", source: "model" });
  });

  it("needs at least three user messages", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    const conversationId = await talkDemo(walter, JOKEY.slice(0, 2));
    expect((await finishConversation(walter.id, conversationId)).styleUpdated).toBe(false);
    expect(await getPersonalityProfile(walter.id)).toBeNull();
  });

  it("a second, very different conversation moves the profile but never flips it; evidence accumulates", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    await finishConversation(walter.id, await talkDemo(walter, JOKEY));
    const first = (await getPersonalityProfile(walter.id))!;
    await finishConversation(walter.id, await talkDemo(walter, TERSE));
    const second = (await getPersonalityProfile(walter.id))!;
    expect(second.evidenceConversations).toBe(2);
    expect(second.evidenceMessages).toBe(JOKEY.length + TERSE.length);
    expect(second.traits.scores.humor).toBeLessThan(first.traits.scores.humor);
    expect(second.traits.scores.humor).toBeGreaterThanOrEqual(first.traits.scores.humor * 0.5);
    expect(second.traits.scores.formality).toBeGreaterThan(first.traits.scores.formality);
    const corrected = (await listMemoryEvents(walter.id)).find((e) => e.event === "corrected" && e.payload.kind === "personality");
    expect(corrected).toBeDefined();
  });
});

describe("three-channel listening in demo mode (text only)", () => {
  it("a frustrated turn stores a frustration tone event, drops humor for the conversation and shows observe_tone in the transcript", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    await setHumorLevel(walter.id, "playful");
    const conversationId = (await startConversation(walter, { mode: "demo", modelKey: "full" })).id;

    const turn = await runDemoTurn(walter.id, conversationId, "ugh, this remote is so frustrating, nothing works");
    expect(turn.reply).toMatch(/frustrating|fed up/i);
    expect(turn.reply).toMatch(/slow|one step/i);
    expect((turn.reply.match(/\?/g) ?? []).length).toBe(1); // one gentle question
    expect(turn.toolCalls.map((t) => t.name)).toEqual(["observe_tone"]);
    expect(turn.toolCalls[0].arguments).toMatchObject({ tone: "frustration", intent: "venting", serious: true });
    expect(turn.toolCalls[0].output).toContain('"stored":true');

    const events = await listRecentToneEvents(walter.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tone: "frustration", intent: "venting", source: "heuristic", conversationId });
    expect(events[0].intensity).toBeGreaterThanOrEqual(0.6);
    expect(events[0].cue).toMatch(/ugh/);

    const state = (await getConversation(walter.id, conversationId))!.metadata.demo as DemoState;
    expect(state.serious).toBe(true);
    // Humor stays off for the rest of the conversation.
    const light = ["We put on an old jazz record and danced in the kitchen", "I did the crossword in pen this morning", "The tomatoes are finally coming in", "I baked an apple pie for the neighbors"].find((t) => maybeQuip(t, "playful", hashText(t)) !== "")!;
    const later = await runDemoTurn(walter.id, conversationId, light);
    expect(later.reply).not.toContain(maybeQuip(light, "playful", hashText(light)));
    // The feel of the conversation reflects it.
    const ended = await finishConversation(walter.id, conversationId);
    expect(ended.feel?.dominantTone).toBe("frustration");
  });

  it("confusion gets a shorter, plainer reply; fatigue gets an offer to wrap up; neutral turns carry no observe_tone entry", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    const conversationId = (await startConversation(walter, { mode: "demo", modelKey: "full" })).id;
    const confused = await runDemoTurn(walter.id, conversationId, "I don't understand, what do you mean by that?");
    expect(confused.reply).toMatch(/more simply|more plainly|say again/i);
    expect(confused.reply.length).toBeLessThan(140);
    expect(confused.toolCalls[0]).toMatchObject({ name: "observe_tone", arguments: { tone: "confusion" } });
    const tired = await runDemoTurn(walter.id, conversationId, "I'm so tired today, exhausted really.");
    expect(tired.reply).toMatch(/stop here|wrap up/i);
    const plain = await runDemoTurn(walter.id, conversationId, "The tomatoes are finally coming in");
    expect(plain.toolCalls.map((t) => t.name)).not.toContain("observe_tone");
    expect(await countToneEvents(walter.id)).toBe(3); // every turn is stored (memory on), notable or not
    expect((await getConversation(walter.id, conversationId))!.metadata.demo).toMatchObject({ serious: false });
  });

  it("the profile adapts the demo brain: gentle humor steps up to playful's quip rate for a jokey user, long-version templates for a talkative one", async () => {
    const user = await onboardedUser(true);
    await setHumorLevel(user.id, "gentle");
    const candidates = ["We put on an old jazz record and danced in the kitchen", "I did the crossword in pen this morning", "The tomatoes are finally coming in", "I baked an apple pie for the neighbors", "My dog chased a squirrel up the oak tree"];
    const light = candidates.find((t) => maybeQuip(t, "gentle", hashText(t)) === "" && maybeQuip(t, "playful", hashText(t)) !== "")!;
    const quip = maybeQuip(light, "playful", hashText(light));

    const before = await runDemoTurn(user.id, (await startConversation(user, { mode: "demo", modelKey: "full" })).id, light);
    expect(before.reply).not.toContain(quip);

    const jokeyTraits = analyzeStyleHeuristic(JOKEY).traits;
    expect(jokeyTraits.scores.humor).toBeGreaterThanOrEqual(STYLE_HUMOR_THRESHOLD);
    await upsertPersonalityProfile(user.id, { traits: { ...jokeyTraits, scores: { ...jokeyTraits.scores, verbosity: STYLE_VERBOSITY_THRESHOLD } }, evidenceConversations: 3, evidenceMessages: 30, source: "heuristic" });
    const after = await runDemoTurn(user.id, (await startConversation(user, { mode: "demo", modelKey: "full" })).id, light);
    expect(after.reply).toContain(quip);
    expect(after.reply).toMatch(/longer version|whole thing|skip the details|rest of it|long version|from the beginning|going through your mind|hear where that goes/);

    // Without memory consent the profile is not read, so nothing changes.
    await recordConsent(user.id, "memory", false, "ui");
    const off = await runDemoTurn(user.id, (await startConversation(user, { mode: "demo", modelKey: "full" })).id, light);
    expect(off.reply).not.toContain(quip);
  });
});

describe("reset, export and isolation", () => {
  it("reset deletes the profile and every tone event, logs it, and the card disappears from the API", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    await finishConversation(walter.id, await talkDemo(walter, JOKEY));
    expect(await getPersonalityProfile(walter.id)).not.toBeNull();
    expect(await countToneEvents(walter.id)).toBeGreaterThan(0);

    await createSession(walter);
    const response = await resetStyleRoute();
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true });
    expect(await getPersonalityProfile(walter.id)).toBeNull();
    expect(await countToneEvents(walter.id)).toBe(0);
    const deleted = (await listMemoryEvents(walter.id)).find((e) => e.event === "deleted" && e.payload.kind === "personality");
    expect(deleted?.payload).toMatchObject({ profile: true });
    expect(Number(deleted?.payload.toneEvents)).toBeGreaterThan(0);
    const body = await readJson<StyleProfileResponse>(await styleRoute());
    expect(body).toEqual({ profile: null, description: [], recentTones: [] });
  });

  it("export includes the profile and the tone events", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    await finishConversation(walter.id, await talkDemo(walter, JOKEY));
    await createSession(walter);
    const body = await readJson<MemoryExport>(await exportRoute());
    expect(body.personality?.userId).toBe(walter.id);
    expect(body.personality?.traits.scores.humor).toBeGreaterThan(0.5);
    expect(body.toneEvents.length).toBe(JOKEY.length);
    expect(body.toneEvents.every((e) => e.userId === walter.id)).toBe(true);
  });

  it("is isolated per user: another user sees nothing and cannot reset it", async () => {
    const walter = (await ensureDemoUser("walter"))!;
    await finishConversation(walter.id, await talkDemo(walter, JOKEY));
    const other = await onboardedUser(true);
    expect(await getPersonalityProfile(other.id)).toBeNull();
    expect(await listRecentToneEvents(other.id)).toEqual([]);
    await createSession(other);
    expect((await readJson<StyleProfileResponse>(await styleRoute())).profile).toBeNull();
    expect(await readJson(await resetStyleRoute())).toEqual({ ok: true });
    expect(await getPersonalityProfile(walter.id)).not.toBeNull();
    expect(await countToneEvents(walter.id)).toBe(JOKEY.length);
    const exported = await readJson<MemoryExport>(await exportRoute());
    expect(exported.personality).toBeNull();
    expect(exported.toneEvents).toEqual([]);
  });
});
