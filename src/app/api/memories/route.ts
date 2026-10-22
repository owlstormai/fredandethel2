/**
 * GET  /api/memories — the user's live memories (all provenance labels, so the UI
 *      can show inferred suggestions) plus the tombstone count.
 * POST /api/memories — save a memory the user typed (userConfirmed: true).
 *      403 consent_required when memory is off; 409 for duplicates/tombstoned.
 */
import { createMemorySchema, type MemoriesResponse, type MemoryResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { countTombstones, listMemories } from "@/lib/database/memories";
import { rememberMemory } from "@/lib/memory/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const GET = withErrorHandling(async () => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const [memories, tombstones] = await Promise.all([listMemories(user.id, { limit: 1000 }), countTombstones(user.id)]);
  return jsonOk<MemoriesResponse>({ memories, tombstones });
});

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const body = await parseBody(request, createMemorySchema);
  const result = await rememberMemory(user.id, { ...body, userConfirmed: true });
  if (result.ok) return jsonOk<MemoryResponse>({ memory: result.memory }, { status: 201 });
  switch (result.reason) {
    case "consent_required":
      throw new HttpError(403, "consent_required", "Memory is turned off. Turn it on in Settings, or say yes when your companion asks, and then save this.");
    case "sensitive_consent_required":
      throw new HttpError(403, "sensitive_consent_required", "This looks like a personal matter (health, money or grief). Turn on sensitive memory in Settings to save it.");
    case "tombstoned":
      throw new HttpError(409, "tombstoned", "This matches something you asked us to forget earlier, so it was not saved.");
    case "duplicate":
      throw new HttpError(409, "duplicate", "You already have a memory that says this.", { existingId: result.existing?.id ?? null });
  }
});
