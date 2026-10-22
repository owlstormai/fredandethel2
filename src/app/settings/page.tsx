import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { voiceOptions } from "@/components/landing/voices";
import { SettingsPage } from "@/components/settings/SettingsPage";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings() {
  await requirePageUser();
  return (
    <AppShell>
      <SettingsPage voices={voiceOptions()} />
    </AppShell>
  );
}
