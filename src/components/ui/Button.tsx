"use client";
import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Text announced while loading (defaults to "Working"). */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "lg",
    loading = false,
    loadingLabel = "Working",
    leadingIcon,
    trailingIcon,
    fullWidth,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClassName(variant, size, className), fullWidth && "w-full")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner label={loadingLabel} className="shrink-0" /> : leadingIcon ? <span className="shrink-0 -ml-1">{leadingIcon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
      {!loading && trailingIcon ? <span className="shrink-0 -mr-1">{trailingIcon}</span> : null}
    </button>
  );
});

export interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  "data-testid"?: string;
  "aria-label"?: string;
  prefetch?: boolean;
}

/** A Next.js <Link> styled as a button (for navigation CTAs). */
export function LinkButton({ href, variant = "secondary", size = "lg", className, children, leadingIcon, trailingIcon, fullWidth, prefetch, ...rest }: LinkButtonProps) {
  return (
    <Link href={href} prefetch={prefetch} className={cn(buttonClassName(variant, size, className), fullWidth && "w-full")} {...rest}>
      {leadingIcon ? <span className="shrink-0 -ml-1">{leadingIcon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
      {trailingIcon ? <span className="shrink-0 -mr-1">{trailingIcon}</span> : null}
    </Link>
  );
}
