"use client";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** One-line plain explanation, shown under the label. */
  description?: ReactNode;
  /** Optional swatch/icon rendered before the label. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** Builds a data-testid for each option, e.g. (v) => `pref-humor-${v}`. */
  optionTestId?: (value: T) => string;
  /** "row": equal columns; "stack": one option per row (good for long descriptions). */
  layout?: "row" | "stack";
  hideLabel?: boolean;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Radio-group semantics with roving tabindex: Arrow keys move and select,
 * Home/End jump, Space/Enter select. Each option is a 48px+ target.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  optionTestId,
  layout = "row",
  hideLabel,
  description,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const id = useId();
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map());

  const enabled = options.filter((o) => !o.disabled);

  function focusAndSelect(next: SegmentedOption<T>) {
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, current: T) {
    const idx = enabled.findIndex((o) => o.value === current);
    if (idx === -1) return;
    let target: SegmentedOption<T> | undefined;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        target = enabled[(idx + 1) % enabled.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        target = enabled[(idx - 1 + enabled.length) % enabled.length];
        break;
      case "Home":
        target = enabled[0];
        break;
      case "End":
        target = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    e.preventDefault();
    if (target) focusAndSelect(target);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div id={`${id}-label`} className={cn("text-[1.0625rem] font-medium text-foreground", hideLabel && "sr-only")}>
        {label}
      </div>
      {description ? (
        <p id={`${id}-desc`} className="-mt-1 text-[0.95rem] text-muted">
          {description}
        </p>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn(
          "grid gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-1.5",
          layout === "row" ? "grid-flow-col auto-cols-fr max-sm:grid-flow-row max-sm:auto-cols-auto" : "grid-cols-1",
        )}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                if (el) refs.current.set(o.value, el);
                else refs.current.delete(o.value);
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled || o.disabled}
              data-testid={optionTestId?.(o.value)}
              data-value={o.value}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, o.value)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-[calc(var(--radius-lg)-6px)] px-4 py-2.5 text-left transition-colors duration-150",
                layout === "row" ? "flex-col items-center justify-center text-center sm:min-h-14" : "",
                selected
                  ? "bg-accent-soft text-foreground shadow-[inset_0_0_0_1.5px_var(--accent)]"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {o.icon ? <span className="shrink-0">{o.icon}</span> : null}
              <span className="min-w-0">
                <span className={cn("block text-[1.0625rem] font-medium", selected && "text-foreground")}>{o.label}</span>
                {o.description ? (
                  <span className={cn("mt-0.5 block text-[0.92rem] leading-snug", selected ? "text-muted" : "text-subtle")}>{o.description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
