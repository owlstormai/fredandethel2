/** Full data export for one user. Everything is user-scoped at the repository layer. */
import type { MemoryExport } from "@/lib/api/contracts";
import { listConsents } from "@/lib/database/consents";
import { listConversations, listMessages } from "@/lib/database/conversations";
import { listMemories } from "@/lib/database/memories";
import { ensurePreferences } from "@/lib/database/preferences";
import { ensureProfile } from "@/lib/database/profiles";
import type { User } from "@/lib/types";

export async function buildMemoryExport(user: User): Promise<MemoryExport> {
  const [profile, preferences, consents, memories, conversations] = await Promise.all([
    ensureProfile(user.id),
    ensurePreferences(user.id),
    listConsents(user.id),
    listMemories(user.id, { includeDeleted: true, limit: 2000 }),
    listConversations(user.id, 200),
  ]);
  const withMessages = [];
  for (const conversation of conversations) {
    withMessages.push({ ...conversation, messages: await listMessages(user.id, conversation.id) });
  }
  return {
    exportedAt: new Date().toISOString(),
    user,
    profile,
    preferences,
    consents,
    memories,
    conversations: withMessages,
  };
}
