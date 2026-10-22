/** Server-safe button class builder (no "use client"), shared by Button, LinkButton and plain <a>/<Link>. */
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "lg" | "xl";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold shadow-[0_10px_30px_-12px_var(--accent-glow)] hover:bg-accent-strong active:translate-y-px",
  secondary:
    "bg-surface-2 text-foreground border border-line-strong hover:bg-white/12 hover:border-white/30 active:translate-y-px",
  ghost: "bg-transparent text-foreground hover:bg-surface-2 active:translate-y-px",
  danger: "bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20 active:translate-y-px",
};

const SIZE: Record<ButtonSize, string> = {
  lg: "min-h-12 px-5 text-[1.0625rem] rounded-[var(--radius-md)] gap-2",
  xl: "min-h-14 px-7 text-[1.125rem] rounded-[var(--radius-lg)] gap-3",
};

export function buttonClassName(variant: ButtonVariant = "secondary", size: ButtonSize = "lg", className?: string): string {
  return cn(
    "inline-flex items-center justify-center select-none whitespace-nowrap font-medium leading-none",
    "transition-[background-color,border-color,transform,opacity] duration-150",
    "disabled:opacity-50 disabled:pointer-events-none aria-busy:cursor-progress",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
