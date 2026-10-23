"use client";
import { cn } from "./integration";

export function StatusLine({ text, tone = "normal", className }: { text: string; tone?: "normal" | "error" | "warning"; className?: string }) {
  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      data-testid="status"
      className={cn(
        "min-h-[1.75rem] text-center text-[1.125rem] leading-relaxed",
        tone === "error" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted",
        className,
      )}
    >
      {text}
    </p>
  );
}
