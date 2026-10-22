/**
 * Demo profiles: clearly fictional, seeded users that let the whole app be
 * exercised without a paid API. They sign in without a password ONLY when
 * COMPANION_ENABLE_DEMO_PROFILES=true, and are always in demo mode.
 * Demo data is isolated exactly like any other user's (user_id scoping).
 */
import { insertConsent, getLatestConsent } from "@/lib/database/consents";
import { insertMemory, insertMemoryEvent, listTombstones, memoryEverExisted } from "@/lib/database/memories";
import { ensurePreferences } from "@/lib/database/preferences";
import { ensureProfile } from "@/lib/database/profiles";
import { findDemoUserBySlug, upsertDemoUser } from "@/lib/database/users";
import { toPublicUser } from "@/lib/database/mappers";
import { extractKeywords, normalizeText } from "@/lib/memory/normalize";
import type { CompanionVoice, HumorLevel, Memory, MemoryCategory, MemoryKind, User } from "@/lib/types";

export interface DemoSeedMemory {
  content: string;
  kind: Exclude<MemoryKind, "summary">;
  category: MemoryCategory;
  importance?: number;
}

export interface DemoProfileDefinition {
  slug: string;
  displayName: string;
  /** Short, honest description shown on the sign-in page. */
  blurb: string;
  companionVoice: CompanionVoice;
  humorLevel: HumorLevel;
  timezone: string;
  memories: DemoSeedMemory[];
}

export const DEMO_PROFILES: readonly DemoProfileDefinition[] = [
  {
    slug: "margaret",
    displayName: "Margaret",
    blurb: "Fictional. 78, retired schoolteacher in Ohio. Crosswords, her garden, and granddaughter Lily's violin. Talks with Ethel.",
    companionVoice: "ethel",
    humorLevel: "gentle",
    timezone: "America/New_York",
    memories: [
      { content: "Margaret is 78 and a retired schoolteacher who taught fourth grade in Ohio for 31 years", kind: "fact", category: "identity", importance: 4 },
      { content: "Loves crossword puzzles and does the Sunday one in pen", kind: "interest", category: "interest", importance: 4 },
      { content: "Tends a vegetable and flower garden; the tomatoes are her pride", kind: "interest", category: "interest", importance: 4 },
      { content: "Granddaughter Lily plays the violin and has a recital coming up", kind: "relationship", category: "family", importance: 5 },
      { content: "Prefers tea over coffee, with a little honey", kind: "preference", category: "preference", importance: 2 },
      { content: "Likes to be called Margaret, never Maggie", kind: "preference", category: "identity", importance: 3 },
    ],
  },
  {
    slug: "walter",
    displayName: "Walter",
    blurb: "Fictional. 82, retired machinist and Cleveland sports fan. Old jazz records, woodworking, widower. Talks with Fred.",
    companionVoice: "fred",
    humorLevel: "playful",
    timezone: "America/New_York",
    memories: [
      { content: "Walter is 82, a retired machinist who worked 40 years at a tool-and-die shop in Cleveland", kind: "fact", category: "identity", importance: 4 },
      { content: "Lifelong Cleveland sports fan, especially the Guardians and the Browns", kind: "interest", category: "interest", importance: 4 },
      { content: "Collects old jazz records and favors Count Basie and Ella Fitzgerald", kind: "interest", category: "interest", importance: 4 },
      { content: "Does woodworking in the garage and is building a birdhouse for the neighbor's kids", kind: "interest", category: "interest", importance: 4 },
      { content: "Widower; his wife June passed away three years ago", kind: "relationship", category: "family", importance: 5 },
      { content: "Takes his coffee black and strong", kind: "preference", category: "preference", importance: 2 },
    ],
  },
];

export function isDemoEnabled(): boolean {
  return process.env.COMPANION_ENABLE_DEMO_PROFILES === "true";
}

export function getDemoProfile(slug: string): DemoProfileDefinition | null {
  return DEMO_PROFILES.find((p) => p.slug === slug) ?? null;
}

export function listDemoProfiles(): Array<{ slug: string; displayName: string; blurb: string; companionVoice: CompanionVoice }> {
  return DEMO_PROFILES.map(({ slug, displayName, blurb, companionVoice }) => ({ slug, displayName, blurb, companionVoice }));
}

/**
 * Idempotently creates the demo user, profile, preferences, seed consent and
 * seed memories. Memories the demo user has since deleted (soft-deleted or
 * tombstoned) are NOT recreated, so "forget" sticks across re-seeds.
 */
export async function seedDemoProfile(definition: DemoProfileDefinition): Promise<{ user: User; created: Memory[] }> {
  const record = await upsertDemoUser(definition.slug);
  const user = toPublicUser(record);
  await ensureProfile(user.id, {
    preferredName: definition.displayName,
    companionVoice: definition.companionVoice,
    onboardingStage: "complete",
    timezone: definition.timezone,
  });
  await ensurePreferences(user.id, { humorLevel: definition.humorLevel, memoryEnabled: true });
  if (!(await getLatestConsent(user.id, "memory"))) {
    await insertConsent(user.id, { scope: "memory", granted: true, source: "seed", evidence: "Seeded demo profile (fictional)." });
  }
  const tombstones = await listTombstones(user.id);
  const created: Memory[] = [];
  for (const seed of definition.memories) {
    const normalized = normalizeText(seed.content);
    if (await memoryEverExisted(user.id, normalized)) continue;
    const keywords = extractKeywords(seed.content);
    const tombstoned = tombstones.some(
      (t) => t.normalized === normalized || (t.keywords.length >= 2 && t.keywords.filter((k) => keywords.includes(k)).length / t.keywords.length >= 0.6),
    );
    if (tombstoned) continue;
    const memory = await insertMemory(user.id, {
      kind: seed.kind,
      category: seed.category,
      content: seed.content,
      normalized,
      status: "confirmed",
      sensitivity: "normal",
      importance: seed.importance ?? 3,
      metadata: { seeded: true, fictional: true },
    });
    await insertMemoryEvent(user.id, memory.id, "created", { status: "confirmed", source: "seed", fictional: true });
    created.push(memory);
  }
  return { user, created };
}

/** Returns the demo user for a slug, seeding it on first use. Null for unknown slugs. */
export async function ensureDemoUser(slug: string): Promise<User | null> {
  const definition = getDemoProfile(slug);
  if (!definition) return null;
  const existing = await findDemoUserBySlug(slug);
  if (existing) {
    // Make sure the supporting rows exist even if the user row predates them.
    await ensureProfile(existing.id, { preferredName: definition.displayName, companionVoice: definition.companionVoice, onboardingStage: "complete" });
    await ensurePreferences(existing.id, { humorLevel: definition.humorLevel, memoryEnabled: true });
    return toPublicUser(existing);
  }
  const { user } = await seedDemoProfile(definition);
  return user;
}
