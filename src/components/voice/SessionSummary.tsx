"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { EndConversationResponse } from "@/lib/api/contracts";
import type { Memory } from "@/lib/types";
import { Button, Card, cn } from "./integration";

export interface SessionSummaryProps {
  summary: EndConversationResponse | null;
  /** Fallback duration when the server did not return one (seconds). */
  connectedSeconds: number;
  simulated: boolean;
  onTalkAgain: () => void;
  /** Injected for tests. */
  confirmMemory?: (id: string) => Promise<void>;
  dismissMemory?: (id: string) => Promise<void>;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  if (minutes === 0) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes} min ${seconds} sec`;
}

const defaultConfirm = async (id: string) => {
  await apiFetch(`/api/memories/${encodeURIComponent(id)}`, { method: "PATCH", json: { confirm: true } });
};
const defaultDismiss = async (id: string) => {
  await apiFetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export function SessionSummary({ summary, connectedSeconds, simulated, onTalkAgain, confirmMemory = defaultConfirm, dismissMemory = defaultDismiss }: SessionSummaryProps) {
  const [decided, setDecided] = useState<Record<string, "confirmed" | "dismissed" | "busy" | "error">>({});
  const seconds = summary?.conversation.connectedSeconds || connectedSeconds;
  const suggestions: Memory[] = summary?.suggestedMemories ?? [];

  async function decide(memory: Memory, action: "confirm" | "dismiss") {
    setDecided((d) => ({ ...d, [memory.id]: "busy" }));
    try {
      if (action === "confirm") await confirmMemory(memory.id);
      else await dismissMemory(memory.id);
      setDecided((d) => ({ ...d, [memory.id]: action === "confirm" ? "confirmed" : "dismissed" }));
    } catch {
      setDecided((d) => ({ ...d, [memory.id]: "error" }));
    }
  }

  return (
    <Card as="section" data-testid="session-summary" title="Thanks for talking with me" padding="lg" className="w-full animate-rise-in">
      <dl className="mb-5 grid grid-cols-1 gap-3 text-[1.0625rem] sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
          <dt className="text-[0.9rem] uppercase tracking-wide text-subtle">We talked for</dt>
          <dd className="text-foreground" data-testid="summary-duration">{formatDuration(seconds)}</dd>
        </div>
        <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
          <dt className="text-[0.9rem] uppercase tracking-wide text-subtle">Mode</dt>
          <dd className="text-foreground">{simulated ? "Simulated demo — no live AI" : "Live conversation"}</dd>
        </div>
      </dl>

      <h3 className="mb-2 text-[1.15rem] font-semibold text-foreground">What I&apos;ll remember</h3>
      {summary?.summary ? (
        <p className="mb-4 rounded-[var(--radius-md)] bg-surface-2 p-3 text-[1.0625rem] leading-relaxed text-foreground" data-testid="summary-text">
          {summary.summary.content}
        </p>
      ) : (
        <p className="mb-4 text-[1.0625rem] text-muted" data-testid="summary-text">
          {summary ? "Nothing new was saved from this conversation." : "I couldn't save a summary of this conversation."}
        </p>
      )}

      {suggestions.length > 0 ? (
        <div className="mb-5">
          <p className="mb-2 text-[1rem] text-muted">A few things I noticed — shall I keep them? Only what you confirm is saved.</p>
          <ul className="flex flex-col gap-3" data-testid="suggested-memories">
            {suggestions.map((memory) => {
              const status = decided[memory.id];
              return (
                <li key={memory.id} data-testid="suggested-memory" className={cn("rounded-[var(--radius-md)] border border-line p-3", status === "dismissed" && "opacity-60")}>
                  <p className="mb-3 text-[1.0625rem] text-foreground">{memory.content}</p>
                  {status === "confirmed" ? (
                    <p className="text-[1rem] text-success">Kept.</p>
                  ) : status === "dismissed" ? (
                    <p className="text-[1rem] text-muted">Not kept.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="lg" variant="primary" onClick={() => decide(memory, "confirm")} loading={status === "busy"} data-testid="memory-confirm">
                        Yes, keep this
                      </Button>
                      <Button size="lg" variant="secondary" onClick={() => decide(memory, "dismiss")} disabled={status === "busy"} data-testid="memory-dismiss">
                        No, forget it
                      </Button>
                      {status === "error" ? <span className="self-center text-[0.95rem] text-danger">That didn&apos;t save — try again.</span> : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Button size="xl" variant="primary" onClick={onTalkAgain} data-testid="talk-again" fullWidth>
        Talk again
      </Button>
    </Card>
  );
}
