"use client";
import { useSyncExternalStore } from "react";
import type { OrbColor } from "@/lib/types";
import { resolveOrbColor } from "./orbPalette";

function subscribe(onChange: () => void) {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-orb-color"] });
  return () => observer.disconnect();
}
function getSnapshot(): OrbColor {
  if (typeof document === "undefined") return "cyan";
  return resolveOrbColor(document.documentElement.getAttribute("data-orb-color"));
}
const getServerSnapshot = (): OrbColor => "cyan";

/** The accent color currently on <html data-orb-color>, live. */
export function useDocumentOrbColor(): OrbColor {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
