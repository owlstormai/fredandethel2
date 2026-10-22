import { cn } from "./cn";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center justify-center", className)}>
      <svg
        className="size-[1.25em] animate-spin-slow"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
