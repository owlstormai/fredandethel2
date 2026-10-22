/**
 * GET /api/usage?range=today|7d|all — the signed-in user's usage and estimated
 * cost summary (developer panel). Estimates only; see UsageSummary.note.
 */
import { z } from "zod";
import type { UsageResponse } from "@/lib/api/contracts";
import { HttpError, jsonOk, withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { getUsageSummary } from "@/lib/usage/tracker";

const rangeSchema = z.enum(["today", "7d", "all"]);

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireApiUser();
  const raw = new URL(request.url).searchParams.get("range") ?? "today";
  const range = rangeSchema.safeParse(raw);
  if (!range.success) throw new HttpError(400, "validation_failed", "range must be today, 7d or all.");
  const summary = await getUsageSummary(user.id, range.data);
  return jsonOk<UsageResponse>(summary);
});
