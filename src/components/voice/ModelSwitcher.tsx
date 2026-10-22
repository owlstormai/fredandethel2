"use client";
import type { ModelKey } from "@/lib/types";
import { MODEL_LABELS } from "./useConversation";
import { Select, cn } from "./integration";

export interface ModelSwitcherProps {
  value: ModelKey;
  onChange: (next: ModelKey) => void;
  disabled?: boolean;
  /** Shown when the user is connected: switching reconnects. */
  connected?: boolean;
  note?: string | null;
  className?: string;
}

const OPTIONS: ReadonlyArray<{ value: ModelKey; label: string }> = [
  { value: "full", label: MODEL_LABELS.full },
  { value: "mini", label: MODEL_LABELS.mini },
];

export function ModelSwitcher({ value, onChange, disabled, connected, note, className }: ModelSwitcherProps) {
  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <Select<ModelKey>
        label="Voice model"
        value={value}
        options={OPTIONS}
        onChange={onChange}
        disabled={disabled}
        data-testid="model-select"
        hint={connected ? "Switching reconnects; your memories and this conversation carry over." : undefined}
      />
      {note ? (
        <p role="status" data-testid="model-switch-note" className="text-[0.95rem] text-muted">
          {note}
        </p>
      ) : null}
    </div>
  );
}
