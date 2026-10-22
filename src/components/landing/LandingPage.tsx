"use client";
import Link from "next/link";
import { useState } from "react";
import type { CompanionVoice } from "@/lib/types";
import { Wordmark } from "@/components/layout/Wordmark";
import { OrbShowcase } from "@/components/orb/OrbShowcase";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Badge } from "@/components/ui/Badge";
import { LinkButton, buttonClassName } from "@/components/ui/Button";
import { ArrowRightIcon, MicIcon } from "@/components/ui/icons";
import { DemoProfiles } from "./DemoProfiles";
import { VoiceChoice, type VoiceOption } from "./VoiceChoice";

export interface LandingPageProps {
  voices: readonly VoiceOption[];
}

const PILLARS = [
  { title: "Just talk", body: "No typing, no menus. Speak naturally, pause when you need to; it waits." },
  { title: "Remembers what you choose", body: "It only keeps what you say it can, and you can see, correct or delete every item." },
  { title: "Warm, not a pushover", body: "Curious, gently funny, and willing to disagree. Serious when it matters." },
];

export function LandingPage({ voices }: LandingPageProps) {
  const { me, loading } = usePreferences();
  const [voice, setVoice] = useState<CompanionVoice | null>(null);
  const signupHref = voice ? `/signup?voice=${voice}` : "/signup";
  const voiceLabels = Object.fromEntries(voices.map((v) => [v.value, v.label])) as Record<CompanionVoice, string>;
  const signedIn = Boolean(me);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Companion home" className="rounded-full py-2">
            <Wordmark />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2">
            {signedIn ? (
              <LinkButton href="/talk" variant="primary" trailingIcon={<ArrowRightIcon />}>
                Continue to Talk
              </LinkButton>
            ) : (
              <>
                <Link href="/login" className="flex min-h-12 items-center rounded-full px-4 text-[1rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground">
                  Sign in
                </Link>
                <LinkButton href={signupHref} variant="secondary" className="hidden sm:inline-flex">
                  Create account
                </LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-24 lg:pt-16">
          <div className="order-2 flex flex-col items-start gap-6 lg:order-1">
            <Badge variant="accent" size="md">
              A voice companion for older adults
            </Badge>
            <h1 className="text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground sm:text-[3.25rem]">
              Someone to talk with, whenever you like.
            </h1>
            <p className="max-w-xl text-[1.25rem] leading-relaxed text-muted">
              Companion is a warm, unhurried voice that listens, remembers only what you ask it to, and knows when to be serious.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
              {signedIn ? (
                <LinkButton href="/talk" variant="primary" size="xl" leadingIcon={<MicIcon />} data-testid="cta-continue">
                  Continue to Talk
                </LinkButton>
              ) : (
                <>
                  <a href="#demo" className={buttonClassName("primary", "xl")} data-testid="cta-demo">
                    Try a demo profile
                  </a>
                  <LinkButton href="/login" variant="secondary" size="xl" data-testid="cta-signin">
                    Sign in
                  </LinkButton>
                  <LinkButton href={signupHref} variant="ghost" size="xl" data-testid="cta-signup">
                    Create account
                  </LinkButton>
                </>
              )}
            </div>
            {!signedIn && !loading ? (
              <p className="text-[1rem] text-subtle">Demo profiles use simulated conversation — no live AI, no account needed.</p>
            ) : null}
          </div>

          <div className="order-1 flex flex-col items-center lg:order-2">
            <div className="relative w-[min(78vw,26rem)]" aria-label="Preview of the Companion orb">
              <OrbShowcase states={["idle"]} initialState="idle" size="fluid" label="Companion" />
              <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2">
                <Badge variant="outline">Preview</Badge>
              </span>
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section aria-label="What makes Companion different" className="mx-auto max-w-6xl px-4 sm:px-6">
          <ul className="grid gap-4 md:grid-cols-3">
            {PILLARS.map((p) => (
              <li key={p.title} className="panel p-6">
                <h2 className="text-[1.25rem] font-semibold text-foreground">{p.title}</h2>
                <p className="mt-2 text-[1.0625rem] leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Voices */}
        <section aria-labelledby="voices-heading" className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:pt-24">
          <div className="max-w-2xl">
            <h2 id="voices-heading" className="text-[2rem] font-semibold leading-tight">
              Two companions. Pick the one that feels right.
            </h2>
            <p className="mt-3 text-[1.125rem] leading-relaxed text-muted">You can change your mind any time in Settings.</p>
          </div>
          <div className="mt-8 max-w-3xl">
            <VoiceChoice voices={voices} value={voice} onChange={setVoice} hideLabel testIdPrefix="landing-voice" />
          </div>
        </section>

        {/* Demo */}
        <section id="demo" aria-labelledby="demo-heading" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-16 sm:px-6 lg:pt-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h2 id="demo-heading" className="text-[2rem] font-semibold leading-tight">
                Try a demo profile
              </h2>
              <p className="mt-3 text-[1.125rem] leading-relaxed text-muted">
                Step into a ready-made profile to see how Companion listens, remembers and talks. Nothing you do here is sent to a live AI.
              </p>
            </div>
          </div>
          <div className="mt-6 rounded-[var(--radius-lg)] border border-warning/30 bg-warning-soft px-5 py-4 text-[1.0625rem] leading-relaxed text-foreground" role="note">
            <strong className="font-semibold text-warning">Demo profiles use simulated conversation — no live AI.</strong> Responses are generated by a small built-in script so you can explore safely.
          </div>
          <div className="mt-8">
            <DemoProfiles voiceLabels={voiceLabels} />
          </div>
        </section>

        {/* Final CTA */}
        {!signedIn ? (
          <section aria-labelledby="start-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="panel flex flex-col items-center gap-6 px-6 py-12 text-center">
              <h2 id="start-heading" className="text-[2rem] font-semibold leading-tight">
                Ready when you are.
              </h2>
              <p className="max-w-xl text-[1.125rem] leading-relaxed text-muted">Create a free account to talk with a real voice and keep the memories you choose.</p>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <LinkButton href={signupHref} variant="primary" size="xl">
                  Create account
                </LinkButton>
                <LinkButton href="/login" variant="secondary" size="xl">
                  Sign in
                </LinkButton>
              </div>
            </div>
          </section>
        ) : (
          <div className="h-16" />
        )}
      </main>

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[0.95rem] text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Companion is not a medical, crisis or emergency service. In an emergency, call your local emergency number.</p>
          <p>Your memories belong to you. View, correct, export or delete them at any time.</p>
        </div>
      </footer>
    </div>
  );
}
