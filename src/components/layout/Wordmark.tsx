import { cn } from "@/components/ui/cn";

/** "Companion" wordmark with a small orb glyph. */
export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-block rounded-full",
          compact ? "size-6" : "size-7",
        )}
        style={{
          background: "radial-gradient(circle at 38% 34%, #fff 0%, var(--accent) 35%, var(--accent-strong) 70%, rgba(0,0,0,0.6) 100%)",
          boxShadow: "0 0 18px -2px var(--accent-glow)",
        }}
      />
      <span className={cn("font-semibold tracking-[-0.02em] text-foreground", compact ? "text-[1.1rem]" : "text-[1.3rem]")}>Companion</span>
    </span>
  );
}
