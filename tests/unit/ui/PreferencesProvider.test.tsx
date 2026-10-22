// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/lib/api/contracts";
import { DEFAULT_PREFERENCES } from "@/lib/types";
import { PreferencesProvider, usePreferences } from "@/components/providers/PreferencesProvider";
import { APPEARANCE_STORAGE_KEY } from "@/components/providers/appearance";

function me(overrides: Partial<MeResponse["preferences"]> = {}): MeResponse {
  return {
    user: { id: "u1", email: "a@b.co", isDemo: false, demoSlug: null, createdAt: "2026-01-01T00:00:00Z" },
    profile: { userId: "u1", preferredName: "Pat", companionVoice: "fred", onboardingStage: "named", timezone: null, createdAt: "", updatedAt: "" },
    preferences: { userId: "u1", updatedAt: "", ...DEFAULT_PREFERENCES, orbColor: "violet", textScale: "xlarge", motion: "reduced", ...overrides },
    consents: { memory: false, sensitive_memory: false, web_search: false, transcripts: false },
    mode: "demo",
    capabilities: { liveConfigured: false, searchConfigured: false, summariesConfigured: false },
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let latest: ReturnType<typeof usePreferences> | null = null;
function Probe() {
  const value = usePreferences();
  useEffect(() => {
    latest = value;
  });
  return (
    <div>
      <span data-testid="loading">{String(value.loading)}</span>
      <span data-testid="name">{value.me?.profile.preferredName ?? "none"}</span>
      <span data-testid="humor">{value.preferences.humorLevel}</span>
      <span data-testid="error">{value.error ?? ""}</span>
    </div>
  );
}

const html = () => document.documentElement;

beforeEach(() => {
  latest = null;
  html().removeAttribute("data-orb-color");
  html().removeAttribute("data-text-scale");
  html().removeAttribute("data-motion");
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<PreferencesProvider />", () => {
  it("loads /api/me and applies appearance attributes to <html>", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, me()));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(fetchMock).toHaveBeenCalledWith("/api/me", expect.objectContaining({ credentials: "same-origin" }));
    expect(screen.getByTestId("name")).toHaveTextContent("Pat");
    expect(html()).toHaveAttribute("data-orb-color", "violet");
    expect(html()).toHaveAttribute("data-text-scale", "xlarge");
    expect(html()).toHaveAttribute("data-motion", "reduced");
    expect(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toEqual({ orbColor: "violet", textScale: "xlarge", motion: "reduced" });
  });

  it("treats 401 as signed out (me = null, no error) and applies defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { code: "unauthenticated", message: "Please sign in." } })));
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ orbColor: "amber", textScale: "normal", motion: "full" }));
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("name")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(screen.getByTestId("humor")).toHaveTextContent(DEFAULT_PREFERENCES.humorLevel);
    expect(html()).toHaveAttribute("data-orb-color", DEFAULT_PREFERENCES.orbColor);
    expect(html()).toHaveAttribute("data-text-scale", DEFAULT_PREFERENCES.textScale);
    expect(html()).toHaveAttribute("data-motion", DEFAULT_PREFERENCES.motion);
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();
  });

  it("surfaces non-auth failures as an error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>404</html>", { status: 404 })));
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("name")).toHaveTextContent("none");
    expect(screen.getByTestId("error").textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it("update() PATCHes /api/preferences optimistically and applies the new appearance", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/me") return jsonResponse(200, me());
      if (String(input) === "/api/preferences" && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        return jsonResponse(200, { preferences: { ...me().preferences, ...patch } });
      }
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await act(async () => {
      await latest!.update({ orbColor: "emerald", humorLevel: "playful" });
    });
    expect(html()).toHaveAttribute("data-orb-color", "emerald");
    expect(screen.getByTestId("humor")).toHaveTextContent("playful");
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/preferences" && init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall![1]!.body))).toEqual({ orbColor: "emerald", humorLevel: "playful" });
  });

  it("reverts the optimistic update when the PATCH fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/me") return jsonResponse(200, me());
        if (init?.method === "PATCH") return jsonResponse(500, { error: { code: "internal_error", message: "boom" } });
        return jsonResponse(404, {});
      }),
    );
    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    await expect(
      act(async () => {
        await latest!.update({ orbColor: "white" });
      }),
    ).rejects.toThrow(/boom/);
    await waitFor(() => expect(html()).toHaveAttribute("data-orb-color", "violet"));
  });
});
