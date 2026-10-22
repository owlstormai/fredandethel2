"use client";
import type { ConsentScope } from "@/lib/types";
import { Button, Card } from "./integration";

export type ConsentCardScope = Extract<ConsentScope, "memory" | "sensitive_memory" | "web_search">;

const COPY: Record<ConsentCardScope, { title: string; body: string; yes: string }> = {
  memory: {
    title: "May I remember things you tell me?",
    body: "I'd keep a few notes — like your name, your interests, and stories you share — so our next chat picks up where we left off. You can see, change or delete anything I remember, any time.",
    yes: "Yes, remember things",
  },
  sensitive_memory: {
    title: "May I also remember personal topics?",
    body: "That means things like health, money, grief or family matters. Only if you're comfortable. You stay in control and can delete them whenever you like.",
    yes: "Yes, that's okay",
  },
  web_search: {
    title: "May I look things up online for you?",
    body: "For news, weather or sports I'd search the web. I never send anything I remember about you — only the question itself.",
    yes: "Yes, you can look things up",
  },
};

export interface ConsentCardProps {
  scope: ConsentCardScope;
  onYes: () => void;
  onNotNow: () => void;
  busy?: boolean;
}

export function ConsentCard({ scope, onYes, onNotNow, busy }: ConsentCardProps) {
  const copy = COPY[scope];
  return (
    <Card
      as="section"
      data-testid="consent-card"
      aria-live="polite"
      title={copy.title}
      description={copy.body}
      padding="md"
      className="w-full border-accent/40 animate-rise-in"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="xl" variant="primary" data-testid="consent-yes" onClick={onYes} loading={busy} className="flex-1">
          {copy.yes}
        </Button>
        <Button size="xl" variant="secondary" data-testid="consent-no" onClick={onNotNow} disabled={busy} className="flex-1">
          Not now
        </Button>
      </div>
    </Card>
  );
}
