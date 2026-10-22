/**
 * Appearance attributes on <html>: data-orb-color, data-text-scale, data-motion.
 * Shared by the PreferencesProvider (after /api/me resolves) and the inline
 * pre-paint script in layout.tsx (from a localStorage cache), so a returning
 * user never sees a flash of the wrong size/color.
 */
import { DEFAULT_PREFERENCES, type MotionPreference, type OrbColor, type TextScale } from "@/lib/types";

export interface Appearance {
  orbColor: OrbColor;
  textScale: TextScale;
  motion: MotionPreference;
}

export const APPEARANCE_STORAGE_KEY = "companion:appearance";

export const ORB_COLORS: readonly OrbColor[] = ["cyan", "violet", "emerald", "amber", "white"];
export const TEXT_SCALES: readonly TextScale[] = ["normal", "large", "xlarge"];
export const MOTION_PREFERENCES: readonly MotionPreference[] = ["system", "reduced", "full"];

export const DEFAULT_APPEARANCE: Appearance = {
  orbColor: DEFAULT_PREFERENCES.orbColor,
  textScale: DEFAULT_PREFERENCES.textScale,
  motion: DEFAULT_PREFERENCES.motion,
};

export function isOrbColor(value: unknown): value is OrbColor {
  return typeof value === "string" && (ORB_COLORS as readonly string[]).includes(value);
}
export function isTextScale(value: unknown): value is TextScale {
  return typeof value === "string" && (TEXT_SCALES as readonly string[]).includes(value);
}
export function isMotionPreference(value: unknown): value is MotionPreference {
  return typeof value === "string" && (MOTION_PREFERENCES as readonly string[]).includes(value);
}

/** Apply to <html> and (optionally) cache for the next page load. */
export function applyAppearance(appearance: Appearance, options: { persist?: boolean } = {}): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-orb-color", appearance.orbColor);
  html.setAttribute("data-text-scale", appearance.textScale);
  html.setAttribute("data-motion", appearance.motion);
  if (options.persist === false) return;
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* storage may be unavailable (private mode); attributes are still applied */
  }
}

export function clearAppearanceCache(): void {
  try {
    window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Inline, dependency-free script run before first paint (see layout.tsx).
 * Kept here so the storage key and allowed values stay in one place.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});if(!s)return;var p=JSON.parse(s);var h=document.documentElement;var c=${JSON.stringify(ORB_COLORS)},t=${JSON.stringify(TEXT_SCALES)},m=${JSON.stringify(MOTION_PREFERENCES)};if(c.indexOf(p.orbColor)>-1)h.setAttribute("data-orb-color",p.orbColor);if(t.indexOf(p.textScale)>-1)h.setAttribute("data-text-scale",p.textScale);if(m.indexOf(p.motion)>-1)h.setAttribute("data-motion",p.motion);}catch(e){}})();`;
