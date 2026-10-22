"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type { createMemorySchema, MemoriesResponse } from "@/lib/api/contracts";
import type { Memory, MemoryStatus } from "@/lib/types";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { InfoIcon, MemoryIcon, SettingsIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { AddMemoryForm } from "./AddMemoryForm";
import { MemoryItem } from "./MemoryItem";
import { STATUS_HEADING, STATUS_ORDER } from "./memoryLabels";

type LoadState = { status: "loading" } | { status: "ready"; data: MemoriesResponse } | { status: "error"; message: string };

function describeLoadError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401) return "Please sign in to see your memories.";
    if (err.status === 404) return "Memory isn't available yet on this server.";
    return err.message;
  }
  return "We couldn't load your memories. Please try again.";
}

export function MemoryPage() {
  const { preferences, me, loading: meLoading } = usePreferences();
  const { toast } = useToast();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(() => {
    return apiFetch<MemoriesResponse>("/api/memories")
      .then((data) => setLoad({ status: "ready", data: { memories: data?.memories ?? [], tombstones: data?.tombstones ?? 0 } }))
      .catch((err: unknown) => setLoad({ status: "error", message: describeLoadError(err) }));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => {
    if (load.status !== "ready") return [];
    const byStatus = new Map<MemoryStatus, Memory[]>();
    for (const m of load.data.memories) {
      if (m.deletedAt) continue;
      const list = byStatus.get(m.status) ?? [];
      list.push(m);
      byStatus.set(m.status, list);
    }
    return STATUS_ORDER.map((status) => ({
      status,
      items: (byStatus.get(status) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }));
  }, [load]);

  const total = load.status === "ready" ? load.data.memories.filter((m) => !m.deletedAt).length : 0;

  async function handleAdd(input: ReturnType<typeof createMemorySchema.parse>) {
    await apiFetch("/api/memories", { method: "POST", json: input });
    toast({ title: "Remembered", description: "Saved as confirmed. Your companion can bring it up.", variant: "success" });
    await reload();
  }

  async function handleEdit(memory: Memory, content: string) {
    setPendingId(memory.id);
    try {
      await apiFetch(`/api/memories/${memory.id}`, { method: "PATCH", json: { content } });
      toast({ title: "Updated", description: "The memory now reads the way you wrote it.", variant: "success", duration: 3000 });
      await reload();
    } finally {
      setPendingId(null);
    }
  }

  async function handleConfirm(memory: Memory) {
    setPendingId(memory.id);
    try {
      await apiFetch(`/api/memories/${memory.id}`, { method: "PATCH", json: { confirm: true } });
      toast({ title: "Confirmed", description: "Moved to \"You asked me to remember\".", variant: "success", duration: 3000 });
      await reload();
    } catch (err) {
      toast({ title: "Couldn't confirm that", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/memories/${deleteTarget.id}`, { method: "DELETE" });
      toast({ title: "Forgotten", description: "It won't come back, not even from summaries.", variant: "success" });
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      toast({ title: "Couldn't delete that", description: err instanceof Error ? err.message : "Please try again.", variant: "error" });
    } finally {
      setDeleting(false);
    }
  }

  const memoryOff = !meLoading && me !== null && !preferences.memoryEnabled;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-[2.25rem] font-semibold leading-tight">What I remember about you</h1>
        <p className="max-w-2xl text-[1.125rem] leading-relaxed text-muted">
          Everything here is yours. Correct anything that&apos;s wrong, confirm what&apos;s right, and delete what you&apos;d rather I forget.
        </p>
      </header>

      {memoryOff ? (
        <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-warning/30 bg-warning-soft p-5 sm:flex-row sm:items-center sm:justify-between" data-testid="memory-off-banner">
          <div className="flex items-start gap-3">
            <InfoIcon className="mt-0.5 size-6 shrink-0 text-warning" />
            <div>
              <p className="text-[1.0625rem] font-semibold text-foreground">Memory is off.</p>
              <p className="text-[1rem] text-muted">Nothing new is being saved, and existing memories aren&apos;t used in conversation. You can still review and delete them here.</p>
            </div>
          </div>
          <Link href="/settings#privacy" className={buttonClassName("secondary", "lg", "shrink-0")}>
            <SettingsIcon className="mr-2 size-5" /> Turn memory on
          </Link>
        </div>
      ) : null}

      <AddMemoryForm onAdd={handleAdd} disabled={load.status === "error"} />

      {load.status === "loading" ? (
        <div className="flex items-center justify-center py-16 text-muted">
          <Spinner className="text-[2rem] text-accent" label="Loading your memories" />
        </div>
      ) : load.status === "error" ? (
        <EmptyState
          icon={<InfoIcon />}
          title="We couldn't load your memories"
          description={load.message}
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={<MemoryIcon />}
          title="Nothing remembered yet"
          description="When you agree to save something during a conversation, or add it above, it will appear here."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(({ status, items }) => (
            <section key={status} aria-labelledby={`group-${status}`} data-testid={`memory-group-${status}`} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id={`group-${status}`} className="text-[1.5rem] font-semibold leading-tight">
                  {STATUS_HEADING[status].title}
                </h2>
                <Badge variant="neutral" size="md">
                  {items.length}
                </Badge>
              </div>
              <p className="-mt-2 max-w-2xl text-[1rem] text-muted">{STATUS_HEADING[status].description}</p>
              {items.length === 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-dashed border-line px-5 py-4 text-[1rem] text-subtle">Nothing here right now.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {items.map((memory) => (
                    <MemoryItem key={memory.id} memory={memory} onEdit={handleEdit} onConfirm={handleConfirm} onDelete={setDeleteTarget} busy={pendingId === memory.id} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {load.status === "ready" ? (
        <p className="text-[1rem] text-subtle" data-testid="memory-tombstones">
          Things you asked me to forget: <strong className="font-semibold text-muted">{load.data.tombstones}</strong>
          {load.data.tombstones > 0 ? " — these are blocked from ever being saved again." : ""}
        </p>
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        locked={deleting}
        tone="danger"
        title="Forget this for good?"
        description="This can't be undone. I'll also remove it from any conversation summaries, and I won't bring it back later, even if it comes up again, unless you tell me afresh."
        data-testid="memory-delete-dialog"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Keep it
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting} loadingLabel="Forgetting" data-testid="memory-delete-confirm">
              Yes, forget it
            </Button>
          </>
        }
      >
        {deleteTarget ? <blockquote className="rounded-[var(--radius-md)] border-l-4 border-danger/50 bg-surface px-4 py-3 text-[1.0625rem] text-foreground">{deleteTarget.content}</blockquote> : null}
      </Dialog>
    </div>
  );
}
