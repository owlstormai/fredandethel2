"use client";
import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/ai/realtime/conversationState";
import { cn } from "./integration";

export interface TranscriptProps {
  entries: TranscriptEntry[];
  companionName: string;
  userName?: string | null;
  className?: string;
}

export function Transcript({ entries, companionName, userName, className }: TranscriptProps) {
  const containerRef = useRef<HTMLElement>(null);
  const lastKey = entries.length ? `${entries[entries.length - 1].id}:${entries[entries.length - 1].text.length}` : "";

  // Scroll the captions panel itself, never the page: scrollIntoView would also
  // scroll the window and push the orb under the header.
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  return (
    <section
      ref={containerRef}
      data-testid="transcript"
      role="log"
      aria-label="Captions"
      className={cn("panel max-h-[32vh] w-full overflow-y-auto p-4 sm:p-5", className)}
    >
      {entries.length === 0 ? (
        <p className="text-center text-[1rem] text-subtle">Captions will appear here as you talk.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              data-testid="transcript-entry"
              data-role={entry.role}
              data-final={entry.final ? "true" : "false"}
              className={cn("flex flex-col gap-1", entry.role === "user" ? "items-end" : "items-start")}
            >
              <span className="text-[0.85rem] uppercase tracking-wide text-subtle">
                {entry.role === "user" ? userName || "You" : companionName}
              </span>
              <p
                className={cn(
                  "max-w-[92%] rounded-[var(--radius-lg)] px-4 py-2.5 text-[1.0625rem] leading-relaxed",
                  entry.role === "user" ? "bg-accent-soft text-foreground" : "bg-surface-2 text-foreground",
                  !entry.final && "opacity-80",
                )}
              >
                {entry.text || <span className="text-subtle">…</span>}
                {!entry.final ? <span className="sr-only"> (still speaking)</span> : null}
              </p>
              {entry.sources?.length ? (
                <ul className="flex max-w-[92%] flex-wrap gap-2 text-[0.9rem]" aria-label="Sources">
                  {entry.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center rounded-full border border-line px-3 text-accent underline-offset-2 hover:underline"
                      >
                        {source.title || new URL(source.url).hostname}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
