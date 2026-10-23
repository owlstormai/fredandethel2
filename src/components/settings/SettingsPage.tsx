"use client";
import Link from "next/link";
import type { VoiceOption } from "@/components/landing/VoiceChoice";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { AppearanceSection } from "./AppearanceSection";
import { CompanionSection } from "./CompanionSection";
import { ConversationSection } from "./ConversationSection";
import { PrivacySection } from "./PrivacySection";

const SECTIONS = [
  { id: "companion", label: "Companion" },
  { id: "conversation", label: "Conversation" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Memory & privacy" },
];

export function SettingsPage({ voices }: { voices: readonly VoiceOption[] }) {
  const { me, loading, error } = usePreferences();

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-muted">
        <Spinner className="text-[2rem] text-accent" label="Loading your settings" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="panel mx-auto max-w-lg p-8 text-center">
        <h1 className="text-[1.75rem] font-semibold">Please sign in</h1>
        <p className="mt-2 text-[1.0625rem] text-muted">{error ?? "Settings are tied to your account."}</p>
        <Link href="/login" className={buttonClassName("primary", "xl", "mt-6")}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[2.25rem] font-semibold leading-tight">Settings</h1>
        <p className="text-[1.125rem] text-muted">Changes save as you make them.</p>
        <nav aria-label="Settings sections" className="mt-2 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-12 items-center rounded-full border border-line px-4 text-[1rem] text-muted hover:bg-surface-2 hover:text-foreground">
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="flex flex-col gap-6 [&>section]:scroll-mt-24">
        <CompanionSection voices={voices} profile={me.profile} />
        <ConversationSection />
        <AppearanceSection />
        <PrivacySection />
      </div>
    </div>
  );
}
