"use client";
import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { Spinner } from "./Spinner";

export { buttonClassName, type ButtonVariant, type ButtonSize } from "./buttonStyles";

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
