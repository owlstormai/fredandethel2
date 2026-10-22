import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth/session";
// TODO(integration): swap for Agent A's `AppShell` from "@/components/layout/AppShell" (prop `compact`).
import { AppShell } from "@/components/_stubs/AppShell";
import { VoiceSession } from "@/components/voice/VoiceSession";

export const metadata: Metadata = { title: "Talk" };

export default async function TalkPage() {
  await requirePageUser();
  return (
    <AppShell compact>
      <VoiceSession />
    </AppShell>
  );
}
