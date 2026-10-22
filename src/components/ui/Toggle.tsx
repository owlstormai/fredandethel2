"use client";
import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  id?: string;
  className?: string;
  "data-testid"?: string;
}

/** Accessible switch: a <button role="switch"> with a large row-sized target. */
export function Toggle({ checked, onChange, label, description, disabled, busy, id, className, ...rest }: ToggleProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const labelId = `${switchId}-label`;
  const descId = description ? `${switchId}-desc` : undefined;
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", className)}>
      <div className="min-w-0 flex-1">
        <label id={labelId} htmlFor={switchId} className="block cursor-pointer text-[1.0625rem] font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p id={descId} className="mt-0.5 text-[0.95rem] leading-snug text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        aria-busy={busy || undefined}
        disabled={disabled}
        data-testid={rest["data-testid"]}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-12 w-[5.25rem] shrink-0 items-center rounded-full border p-1 transition-colors duration-200",
          "disabled:opacity-50 disabled:pointer-events-none",
          checked ? "border-accent/60 bg-accent-soft" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 items-center justify-center rounded-full shadow-md transition-transform duration-200",
            checked ? "translate-x-[2.25rem] bg-accent text-accent-ink" : "translate-x-0 bg-white/80 text-background",
          )}
        >
          {checked ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          ) : null}
        </span>
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}
