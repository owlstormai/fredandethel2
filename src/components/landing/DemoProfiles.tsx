"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type { CompanionVoice } from "@/lib/types";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Badge, SimulatedBadge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

export interface DemoProfile {
  slug: string;
  displayName: string;
  blurb: string;
  companionVoice: CompanionVoice;
}

type LoadState = { status: "loading" } | { status: "ready"; profiles: DemoProfile[] } | { status: "unavailable"; reason: string };

export function DemoProfiles({ voiceLabels }: { voiceLabels: Record<CompanionVoice, string> }) {
  const router = useRouter();
  const { refresh } = usePreferences();
  const { toast } = useToast();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ profiles: DemoProfile[] }>("/api/auth/demo")
      .then((data) => {
        if (cancelled) return;
        const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
        setLoad({ status: "ready", profiles });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason =
          err instanceof ApiClientError && err.status === 403
            ? "Demo profiles are turned off on this server."
            : "Demo profiles aren't available right now.";
        setLoad({ status: "unavailable", reason });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function start(slug: string) {
    setStarting(slug);
    try {
      await apiFetch("/api/auth/demo", { method: "POST", json: { slug } });
      await refresh();
      router.push("/talk");
    } catch (err) {
      toast({
        title: "Couldn't start that demo",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
      setStarting(null);
    }
  }

  if (load.status === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-live="polite">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse-soft rounded-[var(--radius-lg)] border border-line bg-surface" />
        ))}
        <span className="sr-only">Loading demo profiles</span>
      </div>
    );
  }

  if (load.status === "unavailable" || load.profiles.length === 0) {
    return (
      <div role="status" className="rounded-[var(--radius-lg)] border border-dashed border-line-strong px-6 py-8 text-center text-[1.0625rem] text-muted">
        {load.status === "unavailable" ? load.reason : "No demo profiles are set up yet."}
        <span className="mt-2 block text-[1rem] text-subtle">You can still sign in or create an account.</span>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {load.profiles.map((profile) => {
        const busy = starting === profile.slug;
        return (
          <li key={profile.slug}>
            <button
              type="button"
              data-testid={`demo-profile-${profile.slug}`}
              onClick={() => start(profile.slug)}
              disabled={starting !== null}
              aria-busy={busy || undefined}
              className={cn(
                "group flex h-full w-full flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5 text-left transition-colors",
                "hover:border-accent/50 hover:bg-surface-2 disabled:opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-[1.3rem] font-semibold leading-tight text-foreground">{profile.displayName}</span>
                <Badge variant="outline">Talks with {voiceLabels[profile.companionVoice] ?? profile.companionVoice}</Badge>
              </div>
              <p className="flex-1 text-[1rem] leading-relaxed text-muted">{profile.blurb}</p>
              <div className="mt-1 flex items-center justify-between">
                <SimulatedBadge size="sm" />
                <span className="flex items-center gap-1.5 text-[1rem] font-medium text-accent">
                  {busy ? (
                    <>
                      <Spinner label="Starting" /> Starting…
                    </>
                  ) : (
                    <>
                      Start <ArrowRightIcon className="size-5 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
