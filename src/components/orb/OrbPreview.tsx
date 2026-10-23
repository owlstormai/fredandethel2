"use client";
/** Dev-only playground for the orb (route: /orb-preview, 404 in production). */
import { useState } from "react";
import type { OrbColor, OrbState } from "@/lib/types";
import { Toggle } from "@/components/ui/Toggle";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Badge } from "@/components/ui/Badge";
import { ORB_COLOR_LIST, swatchColor } from "./orbPalette";
import { OrbShowcase } from "./OrbShowcase";
import { describeOrbState, ORB_STATES } from "./orbState";

export interface OrbPreviewProps {
  initialState?: OrbState;
  initialColor?: OrbColor;
  initialReduced?: boolean;
  initialCycle?: boolean;
}

export function OrbPreview({ initialState = "idle", initialColor = "cyan", initialReduced = false, initialCycle = false }: OrbPreviewProps) {
  const [color, setColor] = useState<OrbColor>(initialColor);
  const [reduced, setReduced] = useState(initialReduced);
  const [cycle, setCycle] = useState(initialCycle);
  const [state, setState] = useState<OrbState>(initialState);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-[1.75rem] font-semibold">Orb preview</h1>
        <Badge variant="warning">Development only</Badge>
        <Badge variant="outline">Simulated levels</Badge>
      </header>
      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-[min(80vw,30rem)]">
            <OrbShowcase key={`${color}-${reduced}`} initialState={state} states={ORB_STATES} cycle={cycle} color={color} reducedMotion={reduced} showControls label="Fred" onStateChange={setState} />
          </div>
          <p className="text-[1.0625rem] text-muted" data-testid="orb-preview-status">
            {describeOrbState(state, "Fred")}
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <SegmentedControl
            label="Color"
            value={color}
            onChange={setColor}
            layout="stack"
            options={ORB_COLOR_LIST.map((c) => ({
              value: c,
              label: c.charAt(0).toUpperCase() + c.slice(1),
              icon: <span aria-hidden="true" className="block size-6 rounded-full" style={{ background: swatchColor(c) }} />,
            }))}
            optionTestId={(c) => `preview-color-${c}`}
          />
          <Toggle label="Reduced motion" description="Static glow; level only changes brightness." checked={reduced} onChange={setReduced} data-testid="preview-reduced" />
          <Toggle label="Cycle through states" checked={cycle} onChange={setCycle} data-testid="preview-cycle" />
        </div>
      </div>
    </div>
  );
}
