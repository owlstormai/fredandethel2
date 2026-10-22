"use client";
/**
 * PreferencesProvider — the one place the browser learns who is signed in and
 * what they prefer. Loads GET /api/me, applies appearance attributes to <html>,
 * and exposes optimistic PATCH helpers. Agents B and D rely on this exact API:
 *
 *   const { me, loading, error, update, updateProfile, refresh } = usePreferences();
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type { MeResponse } from "@/lib/api/contracts";
import { DEFAULT_PREFERENCES, type Preferences, type Profile } from "@/lib/types";
import { applyAppearance, clearAppearanceCache, DEFAULT_APPEARANCE } from "./appearance";

export type EffectivePreferences = Omit<Preferences, "userId" | "updatedAt">;
export type ProfilePatch = Partial<Pick<Profile, "preferredName" | "companionVoice" | "timezone">>;

export interface PreferencesContextValue {
  /** Null when signed out (401) or not yet loaded. */
  me: MeResponse | null;
  /** True until the first /api/me round-trip settles. */
  loading: boolean;
  /** Non-auth failure message (network, 500). 401 is not an error. */
  error: string | null;
  /** Optimistic PATCH /api/preferences. Reverts and rethrows on failure. */
  update(patch: Partial<Preferences>): Promise<void>;
  /** Optimistic PATCH /api/profile. Reverts and rethrows on failure. */
  updateProfile(patch: ProfilePatch): Promise<void>;
  /** Re-fetch /api/me. */
  refresh(): Promise<void>;
  /** Convenience: me.preferences or DEFAULT_PREFERENCES when signed out. */
  preferences: EffectivePreferences;
  /** Convenience: POST /api/auth/logout and clear local state. */
  signOut(): Promise<void>;
  /** Seed state after login/signup/demo without an extra round-trip. */
  setMe(me: MeResponse | null): void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function appearanceOf(prefs: EffectivePreferences) {
  return { orbColor: prefs.orbColor, textScale: prefs.textScale, motion: prefs.motion };
}

function pickPreferences(data: unknown): Preferences | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.preferences && typeof obj.preferences === "object") return obj.preferences as Preferences;
  if ("humorLevel" in obj && "orbColor" in obj) return obj as unknown as Preferences;
  return null;
}
function pickProfile(data: unknown): Profile | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.profile && typeof obj.profile === "object") return obj.profile as Profile;
  if ("companionVoice" in obj && "onboardingStage" in obj) return obj as unknown as Profile;
  return null;
}

export function PreferencesProvider({ children, initialMe }: { children: ReactNode; initialMe?: MeResponse | null }) {
  const [me, setMeState] = useState<MeResponse | null>(initialMe ?? null);
  const [loading, setLoading] = useState(initialMe === undefined);
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef<MeResponse | null>(initialMe ?? null);
  const requestSeq = useRef(0);

  const commit = useCallback((next: MeResponse | null) => {
    meRef.current = next;
    setMeState(next);
    if (next) applyAppearance(appearanceOf(next.preferences));
    else {
      applyAppearance(DEFAULT_APPEARANCE, { persist: false });
      clearAppearanceCache();
    }
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++requestSeq.current;
    return apiFetch<MeResponse>("/api/me")
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setError(null);
        commit(data);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          setError(null);
          commit(null);
          return;
        }
        // Routes may be missing while the app is being built (404) — treat as signed out, but report it.
        commit(null);
        setError(err instanceof Error ? err.message : "Could not load your profile.");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [commit]);

  useEffect(() => {
    if (initialMe !== undefined) {
      applyAppearance(appearanceOf(initialMe?.preferences ?? DEFAULT_PREFERENCES), { persist: Boolean(initialMe) });
      return;
    }
    void refresh();
  }, [refresh, initialMe]);

  const update = useCallback(
    async (patch: Partial<Preferences>) => {
      const current = meRef.current;
      if (!current) {
        // Signed out: apply appearance locally only (landing page preview, etc.).
        applyAppearance({ ...DEFAULT_APPEARANCE, ...appearanceOf({ ...DEFAULT_PREFERENCES, ...patch }) }, { persist: false });
        return;
      }
      const optimistic: MeResponse = { ...current, preferences: { ...current.preferences, ...patch } };
      commit(optimistic);
      try {
        const data = await apiFetch<unknown>("/api/preferences", { method: "PATCH", json: patch });
        const confirmed = pickPreferences(data);
        if (confirmed && meRef.current) commit({ ...meRef.current, preferences: { ...meRef.current.preferences, ...confirmed } });
      } catch (err) {
        if (meRef.current === optimistic || meRef.current?.user.id === current.user.id) commit({ ...(meRef.current ?? current), preferences: current.preferences });
        throw err;
      }
    },
    [commit],
  );

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      const current = meRef.current;
      if (!current) throw new ApiClientError(401, "unauthorized", "You are not signed in.");
      const optimistic: MeResponse = { ...current, profile: { ...current.profile, ...patch } };
      commit(optimistic);
      try {
        const data = await apiFetch<unknown>("/api/profile", { method: "PATCH", json: patch });
        const confirmed = pickProfile(data);
        if (confirmed && meRef.current) commit({ ...meRef.current, profile: { ...meRef.current.profile, ...confirmed } });
      } catch (err) {
        if (meRef.current?.user.id === current.user.id) commit({ ...(meRef.current ?? current), profile: current.profile });
        throw err;
      }
    },
    [commit],
  );

  const signOut = useCallback(async () => {
    try {
      await apiFetch<void>("/api/auth/logout", { method: "POST" });
    } finally {
      requestSeq.current++;
      commit(null);
    }
  }, [commit]);

  const setMe = useCallback(
    (next: MeResponse | null) => {
      requestSeq.current++;
      setLoading(false);
      setError(null);
      commit(next);
    },
    [commit],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      me,
      loading,
      error,
      update,
      updateProfile,
      refresh,
      preferences: me?.preferences ?? DEFAULT_PREFERENCES,
      signOut,
      setMe,
    }),
    [me, loading, error, update, updateProfile, refresh, signOut, setMe],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within <PreferencesProvider> (mounted in app/layout.tsx)");
  return ctx;
}

/** Same as usePreferences but returns null outside the provider (tests, isolated previews). */
export function usePreferencesOptional(): PreferencesContextValue | null {
  return useContext(PreferencesContext);
}
