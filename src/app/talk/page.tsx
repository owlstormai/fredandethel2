import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
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
