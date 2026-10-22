"use client";
/**
 * AppShell — top bar (wordmark, nav, user chip, sign out) and, on small
 * screens, a bottom nav with large icons and labels. `compact` trims the chrome
 * so /talk gets maximum vertical space for the orb.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { CodeIcon, LogoutIcon, MemoryIcon, MicIcon, SettingsIcon, UserIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { Wordmark } from "./Wordmark";

export interface AppShellProps {
  children: ReactNode;
  /** Minimal chrome: slim header, icon nav, no bottom bar. For /talk. */
  compact?: boolean;
  /** Constrain and pad the main column (default true; compact defaults to false). */
  contained?: boolean;
  className?: string;
}

const NAV = [
  { href: "/talk", label: "Talk", icon: MicIcon },
  { href: "/memory", label: "Memory", icon: MemoryIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/developer", label: "Developer", icon: CodeIcon },
] as const;

export function AppShell({ children, compact = false, contained, className }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, signOut } = usePreferences();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const isContained = contained ?? !compact;

  const displayName = me?.profile.preferredName?.trim() || (me?.user.isDemo ? "Demo" : me?.user.email?.split("@")[0]) || "You";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast({ title: "Signed out", description: "Come back any time.", variant: "success" });
      router.push("/");
    } catch (err) {
      toast({ title: "Could not sign out", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setSigningOut(false);
    }
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className={cn("flex min-h-dvh flex-col", className)}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-accent focus:px-5 focus:py-3 focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header
        className={cn(
          "sticky top-0 z-40 border-b border-line bg-background/70 backdrop-blur-xl",
          compact ? "h-14" : "h-[4.5rem]",
        )}
      >
        <div className={cn("mx-auto flex h-full items-center gap-3 px-4 sm:px-6", !compact && "max-w-6xl")}>
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-full py-2 pr-2" aria-label="Companion home">
            <Wordmark compact={compact} />
          </Link>

          <nav aria-label="Primary" className={cn("ml-2 items-center gap-1", compact ? "hidden sm:flex" : "hidden md:flex")}>
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-2 rounded-full px-4 text-[1rem] font-medium transition-colors",
                    active ? "bg-accent-soft text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-5", active ? "text-accent" : "text-subtle")} />
                  <span className={compact ? "hidden lg:inline" : undefined}>{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            {loading ? (
              <span className="h-10 w-28 animate-pulse-soft rounded-full bg-surface-2" aria-hidden="true" />
            ) : me ? (
              <>
                <Link
                  href="/settings"
                  className="flex min-h-12 min-w-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 hover:bg-surface-2"
                  aria-label={`Signed in as ${displayName}. Open settings.`}
                  data-testid="user-chip"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <UserIcon className="size-5" />
                  </span>
                  <span className="hidden min-w-0 truncate text-[1rem] font-medium sm:block">{displayName}</span>
                  {me.user.isDemo ? <Badge variant="warning" className="hidden sm:inline-flex">Demo profile</Badge> : null}
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  aria-busy={signingOut || undefined}
                  className="flex min-h-12 items-center gap-2 rounded-full px-3 text-[1rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50 sm:px-4"
                  data-testid="sign-out"
                >
                  <LogoutIcon className="size-5" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            ) : (
              <Link href="/login" className="flex min-h-12 items-center rounded-full px-4 text-[1rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          "flex min-h-0 flex-1 flex-col outline-none",
          isContained && "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10",
          !compact && "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10",
        )}
      >
        {children}
      </main>

      {!compact ? (
        <nav
          aria-label="Primary (mobile)"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        >
          <ul className="grid grid-cols-4">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[4.25rem] flex-col items-center justify-center gap-1 text-[0.85rem] font-medium",
                      active ? "text-accent" : "text-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-7" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
