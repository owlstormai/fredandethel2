/** GET /api/memory/export — everything we hold about the signed-in user, as a JSON download. */
import { withErrorHandling } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/auth/session";
import { buildMemoryExport } from "@/lib/memory/export";
import { enforceRateLimit } from "@/lib/privacy/rateLimit";

export const GET = withErrorHandling(async () => {
  const user = await requireApiUser();
  const limited = enforceRateLimit("memories", user.id);
  if (limited) return limited;
  const data = await buildMemoryExport(user);
  const stamp = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="companion-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
