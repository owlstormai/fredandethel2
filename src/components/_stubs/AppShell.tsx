/**
 * TODO(integration): TEMPORARY STUB owned by Agent B. Replace with Agent A's
 * `AppShell` from "@/components/layout/AppShell" (prop `compact`) in
 * src/app/talk/page.tsx and src/components/voice/integration.ts.
 */
import type { ReactNode } from "react";

export function AppShell({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <main className={compact ? "mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4 sm:px-6" : "mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-8"}>
      {children}
    </main>
  );
}
