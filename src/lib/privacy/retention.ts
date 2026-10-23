/**
 * Retention helpers.
 *
 * Policy (docs/SECURITY.md): conversations and their messages are kept so the
 * user can review and export them; summaries live on as memories until the user
 * deletes them. `purgeOldConversations` removes ended conversations older than
 * `days` for ALL users — it is NOT scheduled in the MVP. Run it from a cron or an
 * admin script when a retention window is decided. Memories are never purged by
 * time; the user controls them.
 */
import { query } from "@/lib/database/client";
import { logInfo } from "@/lib/privacy/logging";

export const DEFAULT_RETENTION_DAYS = 365;

export async function purgeOldConversations(days: number = DEFAULT_RETENTION_DAYS): Promise<{ deleted: number }> {
  const safeDays = Math.max(1, Math.floor(days));
  const rows = await query<{ id: string }>(
    `DELETE FROM conversations
     WHERE status <> 'active' AND COALESCE(ended_at, started_at) < now() - ($1::int * interval '1 day')
     RETURNING id`,
    [safeDays],
  );
  logInfo("retention_purge", { days: safeDays, deleted: rows.length });
  return { deleted: rows.length };
}
