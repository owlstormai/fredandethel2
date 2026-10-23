"use client";
import { useId, type SelectHTMLAttributes } from "react";
import { cn } from "./cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  hint?: string;
}

export function Select<T extends string>({ label, value, options, onChange, hint, id, className, ...rest }: SelectProps<T>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={selectId} className="text-[1.0625rem] font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value as T)}
          className={cn(
            "w-full appearance-none rounded-[var(--radius-md)] border border-line-strong bg-surface-2 px-4 py-3 pr-12 text-[1.0625rem] text-foreground",
            "min-h-12 hover:border-white/30",
          )}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled} className="bg-surface-solid text-foreground">
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {hint ? (
        <p id={hintId} className="text-[0.95rem] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
