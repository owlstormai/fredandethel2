"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Required: the accessible name. Shown as a tooltip too. */
  label: string;
  icon: ReactNode;
  variant?: "ghost" | "solid" | "danger";
  size?: "md" | "lg";
  pressed?: boolean;
}

const VARIANT = {
  ghost: "bg-transparent text-muted hover:text-foreground hover:bg-surface-2",
  solid: "bg-surface-2 text-foreground border border-line-strong hover:bg-white/12",
  danger: "bg-transparent text-danger hover:bg-danger-soft",
};
const SIZE = { md: "size-12", lg: "size-14" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "ghost", size = "md", pressed, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
        "aria-pressed:bg-accent-soft aria-pressed:text-accent",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      <span className="text-[1.35em] leading-none [&>svg]:size-[1em]">{icon}</span>
    </button>
  );
});
