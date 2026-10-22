import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { OrbColor, OrbState } from "@/lib/types";
import { OrbPreview } from "@/components/orb/OrbPreview";
import { ORB_STATES } from "@/components/orb/orbState";
import { isOrbColor } from "@/components/orb/orbPalette";

export const metadata: Metadata = { title: "Orb preview" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Development-only playground used for visual checks and screenshots. */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrbPreviewPage(props: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await props.searchParams;
  const state = first(params.state);
  const color = first(params.color);
  return (
    <OrbPreview
      initialState={state && (ORB_STATES as readonly string[]).includes(state) ? (state as OrbState) : "idle"}
      initialColor={isOrbColor(color) ? (color as OrbColor) : "cyan"}
      initialReduced={first(params.reduced) === "1"}
      initialCycle={first(params.cycle) === "1"}
    />
  );
}
