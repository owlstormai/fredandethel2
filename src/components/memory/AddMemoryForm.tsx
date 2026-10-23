"use client";
import { useState, type FormEvent } from "react";
import { createMemorySchema } from "@/lib/api/contracts";
import type { MemoryCategory } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Label, Textarea } from "@/components/ui/Field";
import { PlusIcon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "./memoryLabels";

const SENSITIVE_CATEGORIES: ReadonlySet<MemoryCategory> = new Set(["health", "finances", "grief"]);

export interface AddMemoryFormProps {
  onAdd: (input: ReturnType<typeof createMemorySchema.parse>) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}

export function AddMemoryForm({ onAdd, disabled, disabledReason }: AddMemoryFormProps) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("other");
  const [sensitive, setSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSensitive = sensitive || SENSITIVE_CATEGORIES.has(category);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createMemorySchema.safeParse({
      content,
      category,
      sensitivity: effectiveSensitive ? "sensitive" : "normal",
      kind: category === "story" ? "story" : category === "interest" ? "interest" : category === "preference" ? "preference" : category === "family" || category === "friends" ? "relationship" : "fact",
    });
    if (!parsed.success) {
      setError(content.trim() ? "Please keep it under 1000 characters." : "Please write what you'd like remembered.");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd(parsed.data);
      setContent("");
      setSensitive(false);
      setCategory("other");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Add something you'd like me to remember" description="Write it the way you'd say it. It will be saved as confirmed." id="add-memory">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field error={error}>
          <Label>What should I remember?</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="For example: My granddaughter Maya is studying nursing in Leeds."
            maxLength={1000}
            disabled={disabled}
            data-testid="memory-add-input"
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Category"
            value={category}
            onChange={(v) => setCategory(v)}
            options={CATEGORY_ORDER.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            disabled={disabled}
            data-testid="memory-add-category"
          />
          <Toggle
            label="This is private or sensitive"
            description={SENSITIVE_CATEGORIES.has(category) ? "Health, money and grief are always treated as sensitive." : "Only used when sensitive memory is turned on."}
            checked={effectiveSensitive}
            disabled={disabled || SENSITIVE_CATEGORIES.has(category)}
            onChange={setSensitive}
            data-testid="memory-add-sensitive"
            className="sm:pt-0"
          />
        </div>
        {disabled && disabledReason ? (
          <p className="text-[1rem] text-warning" role="status">
            {disabledReason}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" size="xl" leadingIcon={<PlusIcon />} loading={submitting} loadingLabel="Saving" disabled={disabled} data-testid="memory-add-submit">
            Remember this
          </Button>
        </div>
      </form>
    </Card>
  );
}
