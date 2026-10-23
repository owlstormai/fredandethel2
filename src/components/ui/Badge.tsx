import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger" | "simulated" | "outline";

const VARIANT: Record<BadgeVariant, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  outline: "bg-transparent text-muted border-line-strong",
  accent: "bg-accent-soft text-accent border-accent/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  simulated: "bg-warning-soft text-warning border-warning/40 font-semibold uppercase tracking-[0.08em]",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  icon?: ReactNode;
  size?: "sm" | "md";
}

export function Badge({ variant = "neutral", icon, size = "sm", className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap leading-none",
        size === "sm" ? "px-2.5 py-1 text-[0.8rem]" : "px-3 py-1.5 text-[0.9rem]",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {icon ? <span className="[&>svg]:size-[1.1em]">{icon}</span> : null}
      {children}
    </span>
  );
}

/** Prominent, consistent label for anything that is not live AI. */
export function SimulatedBadge({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <Badge
      variant="simulated"
      size={size}
      className={className}
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 7.8v.2" />
        </svg>
      }
    >
      Simulated
    </Badge>
  );
}
