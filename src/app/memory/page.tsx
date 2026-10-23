import type { Metadata } from "next";
import { requirePageUser } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/AppShell";
import { MemoryPage } from "@/components/memory/MemoryPage";

export const metadata: Metadata = { title: "Memory" };

export default async function Memory() {
  await requirePageUser();
  return (
    <AppShell>
      <MemoryPage />
    </AppShell>
  );
}
