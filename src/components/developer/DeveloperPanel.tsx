"use client";
import { ComparisonPanel } from "./ComparisonPanel";
import { ModeCard } from "./ModeCard";
import { ModelsPanel } from "./ModelsPanel";
import { UsagePanel } from "./UsagePanel";

export interface DeveloperPanelProps {
  user: { id: string; isDemo: boolean; email: string | null };
}

export function DeveloperPanel({ user }: DeveloperPanelProps) {
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Developer</h1>
        <nav aria-label="Sections" className="flex gap-3 text-sm text-slate-300">
          <a href="#mode" className="hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Mode</a>
          <a href="#usage" className="hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Usage</a>
          <a href="#models" className="hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Models</a>
          <a href="#comparison" className="hover:text-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">Comparison</a>
        </nav>
      </header>
      <ModeCard user={user} />
      <UsagePanel />
      <ModelsPanel />
      <ComparisonPanel />
    </div>
  );
}

export default DeveloperPanel;
