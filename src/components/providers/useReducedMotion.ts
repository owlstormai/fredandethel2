"use client";
import { useSyncExternalStore } from "react";
import { usePreferencesOptional } from "./PreferencesProvider";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getSnapshot() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}
const getServerSnapshot = () => false;

/** OS-level preference only. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Effective reduced-motion flag: the in-app preference ("reduced" | "full")
 * wins; "system" (or no provider) follows the OS media query.
 */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const prefs = usePreferencesOptional();
  const motion = prefs?.preferences.motion ?? "system";
  if (motion === "reduced") return true;
  if (motion === "full") return false;
  return system;
}
