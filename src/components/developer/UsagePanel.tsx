"use client";
/**
 * Usage & estimated cost. All figures are estimates derived from configured
 * per-token prices; connected minutes are shown separately from audio tokens
 * because only tokens are billed.
 */
import { useId, useState } from "react";
import type { UsageResponse } from "@/lib/api/contracts";
import type { UsageTotals } from "@/lib/types";
import { Badge, DevCard, ErrorNote, Loading, int, minutes, money } from "./primitives";
import { useJson } from "./useJson";

type Range = UsageResponse["range"];
const RANGES: Array<{ key: Range; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "all", label: "All time" },
];

function TotalsTable({ totals, caption }: { totals: UsageTotals; caption: string }) {
  const rows: Array<[string, string]> = [
    ["Sessions", int(totals.sessions)],
    ["Connected", minutes(totals.connectedSeconds)],
    ["User speech", minutes(totals.userSpeechSeconds)],
    ["Assistant speech", minutes(totals.assistantSpeechSeconds)],
    ["Audio tokens in", int(totals.inputAudioTokens)],
    ["Audio tokens out", int(totals.outputAudioTokens)],
    ["Text tokens in", int(totals.inputTextTokens)],
    ["Text tokens out", int(totals.outputTextTokens)],
    ["Cached (text + audio)", int(totals.cachedTextTokens + totals.cachedAudioTokens)],
    ["Search calls", int(totals.searchCalls)],
    ["Estimated cost", money(totals.estimatedCostUsd)],
  ];
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-white/5">
            <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-400">
              {k}
            </th>
            <td className="py-1 text-right font-mono text-slate-100">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ByModelTable({ byModel }: { byModel: UsageResponse["byModel"] }) {
  if (byModel.length === 0) return <p className="text-sm text-slate-400">No usage recorded in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Usage by model</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th scope="col" className="py-1 pr-3">Model</th>
            <th scope="col" className="py-1 pr-3 text-right">Sessions</th>
            <th scope="col" className="py-1 pr-3 text-right">Audio in</th>
            <th scope="col" className="py-1 pr-3 text-right">Audio out</th>
            <th scope="col" className="py-1 pr-3 text-right">Text</th>
            <th scope="col" className="py-1 pr-3 text-right">Cached</th>
            <th scope="col" className="py-1 pr-3 text-right">Search</th>
            <th scope="col" className="py-1 text-right">Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {byModel.map(({ modelId, totals }) => (
            <tr key={modelId} className="border-t border-white/5 font-mono">
              <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-200">{modelId}</th>
              <td className="py-1 pr-3 text-right">{int(totals.sessions)}</td>
              <td className="py-1 pr-3 text-right">{int(totals.inputAudioTokens)}</td>
              <td className="py-1 pr-3 text-right">{int(totals.outputAudioTokens)}</td>
              <td className="py-1 pr-3 text-right">{int(totals.inputTextTokens + totals.outputTextTokens)}</td>
              <td className="py-1 pr-3 text-right">{int(totals.cachedTextTokens + totals.cachedAudioTokens)}</td>
              <td className="py-1 pr-3 text-right">{int(totals.searchCalls)}</td>
              <td className="py-1 text-right">{money(totals.estimatedCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Single-series bar chart (one hue, thin bars, 2px gaps, recessive axis).
 * Values are also available as a table for screen readers.
 */
function ByDayChart({ byDay }: { byDay: UsageResponse["byDay"] }) {
  const titleId = useId();
  if (byDay.length === 0) return <p className="text-sm text-slate-400">No daily data yet.</p>;
  const width = 480;
  const height = 120;
  const padX = 8;
  const padBottom = 18;
  const padTop = 6;
  const max = Math.max(...byDay.map((d) => d.estimatedCostUsd), 0.0001);
  const slot = (width - padX * 2) / byDay.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const plotH = height - padBottom - padTop;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        className="h-32 w-full max-w-[480px]"
      >
        <title id={titleId}>Estimated cost per day (USD)</title>
        <line x1={padX} x2={width - padX} y1={height - padBottom} y2={height - padBottom} stroke="currentColor" strokeOpacity={0.2} />
        {byDay.map((d, i) => {
          const h = Math.max(d.estimatedCostUsd > 0 ? 2 : 0, (d.estimatedCostUsd / max) * plotH);
          const x = padX + i * slot + (slot - barW) / 2;
          const y = height - padBottom - h;
          const label = d.day.slice(5);
          const showLabel = byDay.length <= 10 || i === 0 || i === byDay.length - 1 || i % Math.ceil(byDay.length / 6) === 0;
          return (
            <g key={d.day}>
              <rect x={x} y={y} width={barW} height={h} rx={h > 4 ? 2 : 0} fill="#22d3ee" fillOpacity={0.85}>
                <title>{`${d.day}: ${money(d.estimatedCostUsd)} across ${d.sessions} session${d.sessions === 1 ? "" : "s"}`}</title>
              </rect>
              {showLabel ? (
                <text x={x + barW / 2} y={height - 5} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Estimated cost and sessions per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Estimated cost</th>
            <th scope="col">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {byDay.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{money(d.estimatedCostUsd)}</td>
              <td>{d.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapBar({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const tone = pct >= 100 ? "bg-rose-400" : pct >= 80 ? "bg-amber-400" : "bg-cyan-400";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-100">
          {money(spent)} / {money(cap)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${money(spent)} of ${money(cap)}`}
        className="h-2 w-full overflow-hidden rounded bg-white/10"
      >
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function UsagePanel() {
  const [range, setRange] = useState<Range>("today");
  const tabsId = useId();
  const { data, error, loading, reload } = useJson<UsageResponse>(`/api/usage?range=${range}`);

  return (
    <DevCard
      id="usage"
      title="Usage & cost"
      actions={
        <div className="flex items-center gap-2">
          <Badge tone="warn">Estimates</Badge>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-white/15 px-2 py-1 text-xs text-slate-200 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Refresh
          </button>
        </div>
      }
    >
      <div role="tablist" aria-label="Usage range" className="mb-3 inline-flex rounded border border-white/15 p-0.5">
        {RANGES.map((r) => {
          const selected = r.key === range;
          return (
            <button
              key={r.key}
              type="button"
              role="tab"
              id={`${tabsId}-${r.key}`}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setRange(r.key)}
              onKeyDown={(e) => {
                const idx = RANGES.findIndex((x) => x.key === range);
                if (e.key === "ArrowRight") setRange(RANGES[(idx + 1) % RANGES.length].key);
                if (e.key === "ArrowLeft") setRange(RANGES[(idx - 1 + RANGES.length) % RANGES.length].key);
              }}
              className={`rounded px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                selected ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:bg-white/5"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${range}`}>
        {loading && !data ? <Loading label="usage" /> : null}
        {error ? <ErrorNote error={error} /> : null}
        {data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-400">Totals</h3>
              <TotalsTable totals={data.totals} caption={`Usage totals, ${range}`} />
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-400">Estimated cost per day</h3>
                <ByDayChart byDay={data.byDay} />
              </div>
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Caps (today, UTC)</h3>
                <div className="space-y-3">
                  <CapBar label="Everyone" spent={data.caps.todaySpendUsd} cap={data.caps.dailyCostCapUsd} />
                  <CapBar label="You" spent={data.caps.userTodaySpendUsd} cap={data.caps.perUserDailyCostCapUsd} />
                  <p className="text-xs text-slate-400">
                    Max session length: <span className="font-mono text-slate-200">{data.caps.maxSessionMinutes} min</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-2">
              <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-400">By model</h3>
              <ByModelTable byModel={data.byModel} />
            </div>
            <p className="text-xs text-slate-400 lg:col-span-2">
              <Badge>pricing {data.pricingVersion}</Badge> <span className="ml-2">{data.note}</span>
            </p>
          </div>
        ) : null}
      </div>
    </DevCard>
  );
}
