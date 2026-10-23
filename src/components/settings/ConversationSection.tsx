"use client";
import type { ModelKey, PauseSensitivity } from "@/lib/types";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Toggle } from "@/components/ui/Toggle";
import { useSavePreference } from "./useSavePreference";

const PAUSE_OPTIONS: Array<{ value: PauseSensitivity; label: string; description: string }> = [
  { value: "patient", label: "Patient", description: "Waits longer before replying. Best if you like to pause and think." },
  { value: "balanced", label: "Balanced", description: "A natural middle ground." },
  { value: "quick", label: "Quick", description: "Jumps in sooner. Best for brisk back-and-forth." },
];

const MODEL_OPTIONS: Array<{ value: ModelKey; label: string; description: string }> = [
  { value: "full", label: "Full quality", description: "The most natural, nuanced conversation." },
  { value: "mini", label: "Lower cost (mini)", description: "Cheaper and a little less nuanced." },
];

export function ConversationSection() {
  const { preferences } = usePreferences();
  const { save, pending } = useSavePreference();

  return (
    <Card title="Conversation" description="How your companion listens and responds." id="conversation">
      <div className="flex flex-col gap-8">
        <SegmentedControl
          label="Pause sensitivity"
          description="How long your companion waits when you go quiet."
          value={preferences.pauseSensitivity}
          options={PAUSE_OPTIONS}
          layout="stack"
          optionTestId={(v) => `pref-pause-${v}`}
          onChange={(v) => {
            if (v !== preferences.pauseSensitivity) void save({ pauseSensitivity: v }, `Pause sensitivity set to ${v}.`);
          }}
        />

        <SegmentedControl
          label="Voice model"
          description="Lower cost (mini) is cheaper and a little less nuanced. Changes take effect on your next conversation; what you've shared carries over either way."
          value={preferences.modelKey}
          options={MODEL_OPTIONS}
          optionTestId={(v) => `pref-model-${v}`}
          onChange={(v) => {
            if (v !== preferences.modelKey) void save({ modelKey: v }, `Model set to ${MODEL_OPTIONS.find((o) => o.value === v)?.label}.`);
          }}
        />

        <div className="border-t border-line pt-4">
          <Toggle
            label="Show captions"
            description="Shows what's being said as text while you talk."
            checked={preferences.captions}
            busy={pending === "captions"}
            onChange={(v) => void save({ captions: v }, v ? "Captions on." : "Captions off.")}
            data-testid="pref-captions"
          />
        </div>
      </div>
    </Card>
  );
}
