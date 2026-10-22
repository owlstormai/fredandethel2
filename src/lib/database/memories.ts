/**
 * Memories, memory events and tombstones. Every query is user-scoped.
 * Soft deletes: `deleted_at` is set; rows are kept for audit and export.
 */
import type { Memory, MemoryEvent, MemoryEventType, MemoryKind, MemoryStatus } from "@/lib/types";
import { mapMemory, mapMemoryEvent, toIsoRequired, type MemoryEventRow, type MemoryRow } from "./mappers";
import { userQuery, userQueryOne } from "./scoped";

const COLUMNS =
  "id, user_id, kind, category, content, normalized, status, sensitivity, importance, source_conversation_id, source_message_id, last_referenced_at, created_at, updated_at, deleted_at, metadata";

export interface InsertMemoryInput {
  kind: MemoryKind;
  category: Memory["category"];
  content: string;
  normalized: string;
  status: MemoryStatus;
  sensitivity: Memory["sensitivity"];
  importance?: number;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function insertMemory(userId: string, input: InsertMemoryInput): Promise<Memory> {
  const row = await userQueryOne<MemoryRow>(
    userId,
    `INSERT INTO memories (user_id, kind, category, content, normalized, status, sensitivity, importance, source_conversation_id, source_message_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING ${COLUMNS}`,
    [
      input.kind,
      input.category,
      input.content,
      input.normalized,
      input.status,
      input.sensitivity,
      input.importance ?? 3,
      input.sourceConversationId ?? null,
      input.sourceMessageId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapMemory(row as MemoryRow);
}

/** A live (not deleted) memory by id. */
export async function getMemory(userId: string, memoryId: string): Promise<Memory | null> {
  const row = await userQueryOne<MemoryRow>(
    userId,
    `SELECT ${COLUMNS} FROM memories WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [memoryId],
  );
  return row ? mapMemory(row) : null;
}

export interface ListMemoriesOptions {
  includeDeleted?: boolean;
  kinds?: MemoryKind[];
  excludeKinds?: MemoryKind[];
  statuses?: MemoryStatus[];
  sensitivity?: Memory["sensitivity"];
  limit?: number;
}

export async function listMemories(userId: string, options: ListMemoriesOptions = {}): Promise<Memory[]> {
  const clauses = ["user_id = $1"];
  const params: unknown[] = [];
  if (!options.includeDeleted) clauses.push("deleted_at IS NULL");
  if (options.kinds?.length) {
    params.push(options.kinds);
    clauses.push(`kind = ANY($${params.length + 1}::text[])`);
  }
  if (options.excludeKinds?.length) {
    params.push(options.excludeKinds);
    clauses.push(`NOT (kind = ANY($${params.length + 1}::text[]))`);
  }
  if (options.statuses?.length) {
    params.push(options.statuses);
    clauses.push(`status = ANY($${params.length + 1}::text[])`);
  }
  if (options.sensitivity) {
    params.push(options.sensitivity);
    clauses.push(`sensitivity = $${params.length + 1}`);
  }
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  const rows = await userQuery<MemoryRow>(
    userId,
    `SELECT ${COLUMNS} FROM memories WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map(mapMemory);
}

/** Live memory whose normalized text equals the given one (optionally restricted to a kind). */
export async function findMemoryByNormalized(userId: string, normalized: string, kind?: MemoryKind): Promise<Memory | null> {
  const row = await userQueryOne<MemoryRow>(
    userId,
    `SELECT ${COLUMNS} FROM memories
     WHERE user_id = $1 AND normalized = $2 AND deleted_at IS NULL AND ($3::text IS NULL OR kind = $3)
     ORDER BY created_at ASC LIMIT 1`,
    [normalized, kind ?? null],
  );
  return row ? mapMemory(row) : null;
}

/** Any memory (live or deleted) with the normalized text — used by idempotent seeding. */
export async function memoryEverExisted(userId: string, normalized: string): Promise<boolean> {
  const row = await userQueryOne<{ id: string }>(
    userId,
    `SELECT id FROM memories WHERE user_id = $1 AND normalized = $2 LIMIT 1`,
    [normalized],
  );
  return row !== null;
}

export interface UpdateMemoryPatch {
  content?: string;
  normalized?: string;
  category?: Memory["category"];
  importance?: number;
  status?: MemoryStatus;
  sensitivity?: Memory["sensitivity"];
}

export async function updateMemory(userId: string, memoryId: string, patch: UpdateMemoryPatch): Promise<Memory | null> {
  const rows = await userQuery<MemoryRow>(
    userId,
    `UPDATE memories SET
       content     = COALESCE($3, content),
       normalized  = COALESCE($4, normalized),
       category    = COALESCE($5, category),
       importance  = COALESCE($6, importance),
       status      = COALESCE($7, status),
       sensitivity = COALESCE($8, sensitivity)
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [memoryId, patch.content ?? null, patch.normalized ?? null, patch.category ?? null, patch.importance ?? null, patch.status ?? null, patch.sensitivity ?? null],
  );
  return rows[0] ? mapMemory(rows[0]) : null;
}

export async function softDeleteMemory(userId: string, memoryId: string): Promise<Memory | null> {
  const rows = await userQuery<MemoryRow>(
    userId,
    `UPDATE memories SET deleted_at = now() WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING ${COLUMNS}`,
    [memoryId],
  );
  return rows[0] ? mapMemory(rows[0]) : null;
}

export async function touchLastReferenced(userId: string, memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  await userQuery(
    userId,
    `UPDATE memories SET last_referenced_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [memoryIds],
  );
}

export async function listSummaryMemories(userId: string, limit = 3): Promise<Memory[]> {
  const rows = await userQuery<MemoryRow>(
    userId,
    `SELECT ${COLUMNS} FROM memories WHERE user_id = $1 AND kind = 'summary' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT $2`,
    [Math.max(1, Math.min(limit, 50))],
  );
  return rows.map(mapMemory);
}

// ----- events ---------------------------------------------------------------
export async function insertMemoryEvent(
  userId: string,
  memoryId: string | null,
  event: MemoryEventType,
  payload: Record<string, unknown> = {},
): Promise<MemoryEvent> {
  const row = await userQueryOne<MemoryEventRow>(
    userId,
    `INSERT INTO memory_events (user_id, memory_id, event, payload) VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, user_id, memory_id, event, payload, created_at`,
    [memoryId, event, JSON.stringify(payload)],
  );
  return mapMemoryEvent(row as MemoryEventRow);
}

export async function listMemoryEvents(userId: string, memoryId?: string, limit = 200): Promise<MemoryEvent[]> {
  const rows = await userQuery<MemoryEventRow>(
    userId,
    `SELECT id, user_id, memory_id, event, payload, created_at FROM memory_events
     WHERE user_id = $1 AND ($2::uuid IS NULL OR memory_id = $2) ORDER BY created_at DESC LIMIT $3`,
    [memoryId ?? null, limit],
  );
  return rows.map(mapMemoryEvent);
}

// ----- tombstones -----------------------------------------------------------
export interface TombstoneRecord {
  id: string;
  userId: string;
  normalized: string;
  keywords: string[];
  createdAt: string;
}

interface TombstoneRow {
  id: string;
  user_id: string;
  normalized: string;
  keywords: string[];
  created_at: Date;
}

const mapTombstone = (row: TombstoneRow): TombstoneRecord => ({
  id: row.id,
  userId: row.user_id,
  normalized: row.normalized,
  keywords: row.keywords ?? [],
  createdAt: toIsoRequired(row.created_at),
});

export async function insertTombstone(userId: string, normalized: string, keywords: string[]): Promise<TombstoneRecord> {
  const row = await userQueryOne<TombstoneRow>(
    userId,
    `INSERT INTO memory_tombstones (user_id, normalized, keywords) VALUES ($1, $2, $3::text[])
     RETURNING id, user_id, normalized, keywords, created_at`,
    [normalized, keywords],
  );
  return mapTombstone(row as TombstoneRow);
}

export async function listTombstones(userId: string): Promise<TombstoneRecord[]> {
  const rows = await userQuery<TombstoneRow>(
    userId,
    `SELECT id, user_id, normalized, keywords, created_at FROM memory_tombstones WHERE user_id = $1 ORDER BY created_at DESC`,
  );
  return rows.map(mapTombstone);
}

export async function countTombstones(userId: string): Promise<number> {
  const row = await userQueryOne<{ count: string }>(
    userId,
    `SELECT count(*)::text AS count FROM memory_tombstones WHERE user_id = $1`,
  );
  return Number(row?.count ?? 0);
}
