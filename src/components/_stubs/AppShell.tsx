/**
 * TODO(integration): compatibility shim only. Agent A's real AppShell has landed;
 * src/app/developer/page.tsx (Agent D) still imports this path. Point that import
 * at "@/components/layout/AppShell" and delete this file.
 */
export { AppShell, type AppShellProps } from "@/components/layout/AppShell";
