"use client";
import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { ConsentScope, Preferences } from "@/lib/types";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ArrowRightIcon, DownloadIcon, TrashIcon } from "@/components/ui/icons";
import { Toggle } from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

type ConsentToggleKey = "memoryEnabled" | "sensitiveMemoryEnabled" | "searchEnabled";

const CONSENT_SCOPE: Record<ConsentToggleKey, ConsentScope> = {
  memoryEnabled: "memory",
  sensitiveMemoryEnabled: "sensitive_memory",
  searchEnabled: "web_search",
};

export function PrivacySection() {
  const { preferences, update } = usePreferences();
  const { toast } = useToast();
  const [pending, setPending] = useState<ConsentToggleKey | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function setConsent(key: ConsentToggleKey, granted: boolean, onLabel: string, offLabel: string) {
    setPending(key);
    const patch: Partial<Preferences> = { [key]: granted };
    try {
      await Promise.all([
        update(patch),
        apiFetch("/api/consent", { method: "POST", json: { scope: CONSENT_SCOPE[key], granted, source: "ui" } }),
      ]);
      toast({ title: "Saved", description: granted ? onLabel : offLabel, variant: "success", duration: 3000 });
    } catch (err) {
      toast({ title: "Couldn't save that", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setPending(null);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const response = await fetch("/api/memory/export", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(response.status === 404 ? "Export isn't available yet." : `Export failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `companion-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Your data is downloading", description: "A JSON file with your profile, memories and conversations.", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't export your data", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card title="Memory & privacy" description="You decide what's kept. Nothing is remembered without your say-so." id="privacy">
      <div className="flex flex-col divide-y divide-line">
        <Toggle
          label="Remember things about me"
          description="Keeps facts, interests and stories you agree to save, so future conversations pick up where you left off."
          checked={preferences.memoryEnabled}
          busy={pending === "memoryEnabled"}
          onChange={(v) => void setConsent("memoryEnabled", v, "Memory is on. Your companion will ask before saving anything.", "Memory is off. Nothing new will be saved.")}
          data-testid="pref-memory"
          className="py-4"
        />
        <Toggle
          label="Also remember sensitive topics"
          description="Health, money, grief and family matters. Off by default; only used when memory is on."
          checked={preferences.sensitiveMemoryEnabled}
          busy={pending === "sensitiveMemoryEnabled"}
          onChange={(v) => void setConsent("sensitiveMemoryEnabled", v, "Sensitive topics can now be remembered when you agree.", "Sensitive topics won't be saved.")}
          data-testid="pref-sensitive"
          className="py-4"
        />
        <Toggle
          label="Look things up online"
          description="On by default. Lets your companion check news, weather and sports. Your memories are never sent along with a search; switch off to stop all online lookups."
          checked={preferences.searchEnabled}
          busy={pending === "searchEnabled"}
          onChange={(v) => void setConsent("searchEnabled", v, "Online lookups are on.", "Online lookups are off.")}
          data-testid="pref-search"
          className="py-4"
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link href="/memory" className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-md)] border border-line-strong bg-surface-2 px-5 text-[1.0625rem] font-medium text-foreground hover:bg-white/12">
          See what I remember <ArrowRightIcon className="size-5" />
        </Link>
        <Button variant="secondary" leadingIcon={<DownloadIcon />} onClick={exportData} loading={exporting} loadingLabel="Preparing export" data-testid="export-data">
          Export my data
        </Button>
      </div>

      <div className="mt-8 rounded-[var(--radius-lg)] border border-danger/25 bg-danger-soft/50 p-5">
        <h3 className="text-[1.15rem] font-semibold text-foreground">Delete my account and data</h3>
        <p className="mt-1.5 text-[1rem] leading-relaxed text-muted">Removes everything: account, memories, summaries and settings. This cannot be undone.</p>
        <Button variant="danger" className="mt-4" leadingIcon={<TrashIcon />} onClick={() => setDeleteOpen(true)} data-testid="delete-account">
          Delete my account and data
        </Button>
      </div>

      <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </Card>
  );
}
