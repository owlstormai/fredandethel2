/**
 * PATCH  /api/memories/:id — edit content/category/importance (logs "corrected");
 *        `confirm: true` promotes to "confirmed" (logs "confirmed"). Any other status
 *        change is refused (400 by the strict schema).
 * DELETE /api/memories/:id — forget: soft-delete, tombstone, redact summaries.
 */
import { patchMemorySchema, type DeleteMemoryResponse, type MemoryResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, parseBody, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { getMemory, updateMemory } from "@/lib/database/memories";
import { normalizeText } from "@/lib/memory/normalize";
import { logMemoryEvent } from "@/lib/memory/repository";
import { forgetMemory } from "@/lib/memory/service";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

type Context = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: Context) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const patch = await parseBody(request, patchMemorySchema);
  const existing = await getMemory(user.id, id);
  if (!existing) throw new HttpError(404, "memory_not_found", "That memory could not be found.");
  if (existing.kind === "summary" && patch.confirm) {
    throw new HttpError(400, "status_change_refused", "Summaries cannot be confirmed as facts.");
  }

  let memory = existing;
  const contentChanged = patch.content !== undefined && patch.content !== existing.content;
  if (contentChanged || patch.category !== undefined || patch.importance !== undefined) {
    memory =
      (await updateMemory(user.id, id, {
        content: contentChanged ? patch.content : undefined,
        normalized: contentChanged ? normalizeText(patch.content as string) : undefined,
        category: patch.category,
        importance: patch.importance,
      })) ?? memory;
    await logMemoryEvent(user.id, id, "corrected", {
      changed: [contentChanged ? "content" : null, patch.category !== undefined ? "category" : null, patch.importance !== undefined ? "importance" : null].filter(Boolean),
      previousContent: contentChanged ? existing.content : undefined,
    });
  }
  if (patch.confirm && memory.status !== "confirmed") {
    memory = (await updateMemory(user.id, id, { status: "confirmed" })) ?? memory;
    await logMemoryEvent(user.id, id, "confirmed", { previousStatus: existing.status });
  }
  return jsonOk<MemoryResponse>({ memory });
});

export const DELETE = withErrorHandling(async (_request: Request, context: Context) => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const { id } = await context.params;
  const { deleted } = await forgetMemory(user.id, { memoryId: id });
  if (deleted.length === 0) throw new HttpError(404, "memory_not_found", "That memory could not be found.");
  return jsonOk<DeleteMemoryResponse>({ deleted });
});
