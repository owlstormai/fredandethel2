/**
 * /developer — usage & cost, model configs, API verification, comparison mode.
 * Server component: auth-gated; the panels fetch their own JSON client-side.
 */
// TODO(integration): switch to "@/components/layout/AppShell" (Agent A) and delete the stub.
import { AppShell } from "@/components/_stubs/AppShell";
import { DeveloperPanel } from "@/components/developer/DeveloperPanel";
import { requirePageUser } from "@/lib/auth/session";

export const metadata = { title: "Developer — Companion" };

export default async function DeveloperPage() {
  const user = await requirePageUser();
  return (
    <AppShell>
      <DeveloperPanel user={{ id: user.id, isDemo: user.isDemo, email: user.email }} />
    </AppShell>
  );
}
