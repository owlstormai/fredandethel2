"use client";
import type { MotionPreference, OrbColor, TextScale } from "@/lib/types";
import { Orb } from "@/components/orb/Orb";
import { ORB_COLOR_LIST, swatchColor } from "@/components/orb/orbPalette";
import { usePreferences } from "@/components/providers/PreferencesProvider";
import { Card } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useSavePreference } from "./useSavePreference";

const COLOR_LABEL: Record<OrbColor, string> = { cyan: "Cyan", violet: "Violet", emerald: "Emerald", amber: "Amber", white: "White" };

const TEXT_OPTIONS: Array<{ value: TextScale; label: string; description: string }> = [
  { value: "normal", label: "Standard", description: "Compact." },
  { value: "large", label: "Large", description: "Our default." },
  { value: "xlarge", label: "Extra large", description: "Biggest and boldest." },
];

const MOTION_OPTIONS: Array<{ value: MotionPreference; label: string; description: string }> = [
  { value: "system", label: "Match my device", description: "Follows your device's motion setting." },
  { value: "reduced", label: "Less movement", description: "The orb glows instead of moving." },
  { value: "full", label: "Full animation", description: "Rings, ripples and breathing." },
];

export function AppearanceSection() {
  const { preferences } = usePreferences();
  const { save } = useSavePreference();

  return (
    <Card title="Appearance" description="Make it comfortable for your eyes." id="appearance">
      <div className="grid gap-8 lg:grid-cols-[1fr_12rem]">
        <div className="flex flex-col gap-8">
          <SegmentedControl
            label="Orb color"
            value={preferences.orbColor}
            options={ORB_COLOR_LIST.map((color) => ({
              value: color,
              label: COLOR_LABEL[color],
              icon: (
                <span
                  aria-hidden="true"
                  className="block size-7 rounded-full border border-white/20"
                  style={{ background: `radial-gradient(circle at 35% 30%, #fff 0%, ${swatchColor(color)} 40%, rgba(0,0,0,0.5) 100%)` }}
                />
              ),
            }))}
            optionTestId={(v) => `pref-color-${v}`}
            onChange={(v) => {
              if (v !== preferences.orbColor) void save({ orbColor: v }, `Orb color set to ${COLOR_LABEL[v].toLowerCase()}.`);
            }}
          />

          <SegmentedControl
            label="Text size"
            value={preferences.textScale}
            options={TEXT_OPTIONS}
            optionTestId={(v) => `pref-textscale-${v}`}
            onChange={(v) => {
              if (v !== preferences.textScale) void save({ textScale: v }, `Text size set to ${TEXT_OPTIONS.find((o) => o.value === v)?.label.toLowerCase()}.`);
            }}
          />

          <SegmentedControl
            label="Motion"
            value={preferences.motion}
            options={MOTION_OPTIONS}
            optionTestId={(v) => `pref-motion-${v}`}
            onChange={(v) => {
              if (v !== preferences.motion) void save({ motion: v }, `Motion set to "${MOTION_OPTIONS.find((o) => o.value === v)?.label}".`);
            }}
          />
        </div>

        <div className="flex flex-col items-center gap-2 lg:pt-8">
          <Orb state="idle" micLevel={0} outputLevel={0} size={176} label="Preview" />
          <p className="text-[0.95rem] text-subtle">Live preview</p>
        </div>
      </div>
    </Card>
  );
}
