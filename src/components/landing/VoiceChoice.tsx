"use client";
import type { CompanionVoice } from "@/lib/types";
import { cn } from "@/components/ui/cn";

export interface VoiceOption {
  value: CompanionVoice;
  label: string;
  description: string;
}

export interface VoiceChoiceProps {
  voices: readonly VoiceOption[];
  value: CompanionVoice | null;
  onChange: (voice: CompanionVoice) => void;
  label?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  testIdPrefix?: string;
  className?: string;
}

/** Fred / Ethel cards with radio semantics. */
export function VoiceChoice({ voices, value, onChange, label = "Choose a voice", hideLabel, disabled, testIdPrefix = "voice", className }: VoiceChoiceProps) {
  return (
    <fieldset className={cn("min-w-0", className)} disabled={disabled}>
      <legend className={cn("mb-3 text-[1.0625rem] font-medium text-foreground", hideLabel && "sr-only")}>{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-2">
        {voices.map((voice) => {
          const selected = voice.value === value;
          return (
            <button
              key={voice.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`${testIdPrefix}-${voice.value}`}
              onClick={() => onChange(voice.value)}
              className={cn(
                "group flex min-h-[5.5rem] items-center gap-4 rounded-[var(--radius-lg)] border p-4 text-left transition-colors duration-150",
                selected ? "border-accent/70 bg-accent-soft shadow-[0_0_0_1px_var(--accent)]" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
                "disabled:opacity-50",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-14 shrink-0 items-center justify-center rounded-full text-[1.5rem] font-semibold transition-colors",
                  selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted group-hover:text-foreground",
                )}
              >
                {voice.label.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block text-[1.25rem] font-semibold leading-tight text-foreground">{voice.label}</span>
                <span className="mt-1 block text-[1rem] leading-snug text-muted">{voice.description}</span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "ml-auto flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong",
                )}
              >
                {selected ? (
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
