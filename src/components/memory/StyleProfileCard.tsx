"use client";
/**
 * "How you like to talk" — the user's inferred conversation-style profile.
 * Everything on this card is an inference from the WORDS of past conversations
 * (laughter markers, question marks, sentence length, warmth and humor words),
 * never from the sound of the voice, and the copy says so. Resettable; hidden
 * when there is no profile yet.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { StyleProfileResponse } from "@/lib/api/contracts";
import { INTENT_LABEL, TONE_LABEL } from "@/lib/memory/tone";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { formatMemoryDate } from "./memoryLabels";

type LoadState = { status: "loading" } | { status: "ready"; data: StyleProfileResponse } | { status: "error" };

const MAX_RECENT_SHOWN = 8;

export function StyleProfileCard() {
  const { toast } = useToast();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const reload = useCallback(() => {
    return apiFetch<StyleProfileResponse>("/api/profile/style")
      .then((data) => setLoad({ status: "ready", data: { profile: data?.profile ?? null, description: data?.description ?? [], recentTones: data?.recentTones ?? [] } }))
      .catch(() => setLoad({ status: "error" }));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleReset() {
    setResetting(true);
    try {
      await apiFetch("/api/profile/style", { method: "DELETE" });
      toast({ title: "Reset", description: "I'll start fresh on how you like to talk.", variant: "success", duration: 3000 });
      setConfirming(false);
      setLoad({ status: "ready", data: { profile: null, description: [], recentTones: [] } });
    } catch (err) {
      toast({ title: "Couldn't reset that", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setResetting(false);
    }
  }

  if (load.status !== "ready" || !load.data.profile) return null;
  const { profile, description, recentTones } = load.data;
  const conversations = profile.evidenceConversations;
  const recent = recentTones.filter((t) => t.tone !== "neutral" || t.intent).slice(0, MAX_RECENT_SHOWN);

  return (
    <>
      <Card
        as="section"
        data-testid="style-profile"
        title="How you like to talk"
        description="A picture of your conversational style, so your companion can match it — inferred from the words you use, never from the sound of your voice."
        actions={
          <>
            <Badge variant="warning" size="md" data-testid="style-profile-badge">
              Inferred
            </Badge>
            <Button variant="secondary" size="lg" onClick={() => setConfirming(true)} data-testid="style-profile-reset">
              Reset this
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[1.0625rem] sm:grid-cols-[max-content_1fr]" data-testid="style-profile-rows">
          {description.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-semibold text-foreground">{row.label}</dt>
              <dd className="text-muted">{row.value}</dd>
            </div>
          ))}
        </dl>
        {profile.summary ? <p className="mt-4 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[1.0625rem] leading-relaxed text-foreground">{profile.summary}</p> : null}
        {recent.length > 0 ? (
          <div className="mt-5" data-testid="style-profile-recent">
            <h3 className="mb-2 text-[1.05rem] font-semibold text-foreground">What I&apos;ve noticed lately</h3>
            <ul className="flex flex-col gap-1.5 text-[1rem] text-muted">
              {recent.map((t, i) => (
                <li key={`${t.createdAt}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-foreground">{TONE_LABEL[t.tone]}</span>
                  {t.intent ? <span>· {INTENT_LABEL[t.intent]}</span> : null}
                  <span className="text-subtle">· {formatMemoryDate(t.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-4 text-[1rem] text-subtle" data-testid="style-profile-evidence">
          Based on {conversations} conversation{conversations === 1 ? "" : "s"}, inferred from your words, not your voice. It is covered by your memory setting and goes when you reset it or delete your account.
        </p>
      </Card>

      <Dialog
        open={confirming}
        onClose={() => {
          if (!resetting) setConfirming(false);
        }}
        locked={resetting}
        tone="danger"
        title="Start fresh on how you like to talk?"
        description="This removes what I've inferred about your conversational style and everything I've noticed about how you sound. I'll build a new picture from future conversations if memory stays on."
        data-testid="style-profile-dialog"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={resetting}>
              Keep it
            </Button>
            <Button variant="danger" onClick={handleReset} loading={resetting} loadingLabel="Resetting" data-testid="style-profile-confirm">
              Yes, reset it
            </Button>
          </>
        }
      />
    </>
  );
}
