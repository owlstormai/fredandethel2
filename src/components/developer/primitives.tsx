"use client";
/** Dense, developer-oriented building blocks. Plain Tailwind, high contrast, keyboard friendly. */
import type { ReactNode } from "react";

export function DevCard({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "info" | "warn" | "ok" | "danger" }) {
  const tones: Record<string, string> = {
    neutral: "border-white/15 text-slate-300",
    info: "border-cyan-400/40 text-cyan-200",
    warn: "border-amber-400/50 text-amber-200",
    ok: "border-emerald-400/50 text-emerald-200",
    danger: "border-rose-400/50 text-rose-200",
  };
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[11px] leading-4 ${tones[tone]}`}>{children}</span>
  );
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-400">{k}</dt>
          <dd className="font-mono text-slate-100">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorNote({ error }: { error: { code: string; message: string; status: number } }) {
  return (
    <p role="alert" className="rounded border border-rose-400/40 bg-rose-500/10 p-2 text-sm text-rose-100">
      <span className="font-mono">{error.status || "—"} {error.code}</span>: {error.message}
    </p>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="text-sm text-slate-400">
      Loading {label}…
    </p>
  );
}

export const money = (usd: number): string => (usd > 0 && usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);
export const minutes = (seconds: number): string => `${(seconds / 60).toFixed(1)} min`;
export const int = (n: number): string => n.toLocaleString("en-US");
