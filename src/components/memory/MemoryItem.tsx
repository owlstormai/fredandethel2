"use client";
import { useState } from "react";
import type { Memory } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Field, Label, Textarea } from "@/components/ui/Field";
import { CheckIcon, PencilIcon, TrashIcon } from "@/components/ui/icons";
import { CATEGORY_LABEL, formatMemoryDate, STATUS_HEADING } from "./memoryLabels";

export interface MemoryItemProps {
  memory: Memory;
  onEdit: (memory: Memory, content: string) => Promise<void>;
  onConfirm: (memory: Memory) => Promise<void>;
  onDelete: (memory: Memory) => void;
  busy?: boolean;
}

export function MemoryItem({ memory, onEdit, onConfirm, onDelete, busy }: MemoryItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSummary = memory.kind === "summary" || memory.status === "summarized";
  const canConfirm = memory.status !== "confirmed" && !isSummary;

  async function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Please write something, or cancel.");
      return;
    }
    if (trimmed.length > 1000) {
      setError("Please keep it under 1000 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onEdit(memory, trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the change.");
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    setConfirming(true);
    try {
      await onConfirm(memory);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <li
      data-testid="memory-item"
      data-memory-id={memory.id}
      data-status={memory.status}
      className={cn("rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors", memory.status === "inferred" && "border-dashed")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={memory.status === "confirmed" ? "success" : memory.status === "inferred" ? "outline" : "neutral"}>{STATUS_HEADING[memory.status].badge}</Badge>
        <Badge variant="accent">{CATEGORY_LABEL[memory.category] ?? memory.category}</Badge>
        {memory.sensitivity === "sensitive" ? <Badge variant="warning">Sensitive</Badge> : null}
        <span className="ml-auto text-[0.95rem] text-subtle">
          <time dateTime={memory.createdAt}>{formatMemoryDate(memory.createdAt)}</time>
        </span>
      </div>

      {editing ? (
        <div className="mt-4 flex flex-col gap-3">
          <Field error={error}>
            <Label className="sr-only">Edit memory</Label>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} autoFocus data-testid="memory-edit-input" />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(memory.content);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={saveEdit} loading={saving} loadingLabel="Saving" data-testid="memory-edit-save">
              Save change
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[1.125rem] leading-relaxed text-foreground">{memory.content}</p>
      )}

      {!editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" leadingIcon={<PencilIcon />} onClick={() => setEditing(true)} disabled={busy} data-testid="memory-edit">
            Edit
          </Button>
          {canConfirm ? (
            <Button variant="secondary" leadingIcon={<CheckIcon />} onClick={confirm} loading={confirming} loadingLabel="Confirming" disabled={busy} data-testid="memory-confirm">
              {memory.status === "inferred" ? "Yes, that's right" : "Confirm"}
            </Button>
          ) : null}
          <Button variant="danger" leadingIcon={<TrashIcon />} onClick={() => onDelete(memory)} disabled={busy} className="sm:ml-auto" data-testid="memory-delete">
            {memory.status === "inferred" ? "No, forget it" : "Delete"}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
