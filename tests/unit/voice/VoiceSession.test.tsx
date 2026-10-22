// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConnectOptions, AdapterEvent, AdapterSessionInfo, ConversationAdapter } from "@/lib/ai/adapters/types";
import type { MeResponse } from "@/lib/api/contracts";

const hoisted = vi.hoisted(() => {
  class FakeAdapter implements ConversationAdapter {
    mode = "demo" as const;
    onEvent: ((e: AdapterEvent) => void) | null = null;
    info: AdapterSessionInfo = {
      mode: "demo",
      conversationId: "22222222-2222-4222-8222-222222222222",
      modelKey: "full",
      modelId: "demo-full",
      voiceLabel: "Fred",
      voiceId: "browser-speech",
      context: { memoryCount: 1, summaryCount: 0, estimatedTokens: 0 },
      simulated: true,
      expiresAt: null,
    };
    connect = vi.fn(async (opts: AdapterConnectOptions) => {
      this.onEvent = opts.onEvent;
      opts.onEvent({ type: "status", status: "connecting" });
      opts.onEvent({ type: "status", status: "connected" });
      opts.onEvent({ type: "session", info: this.info });
      return this.info;
    });
    disconnect = vi.fn(async (reason?: string) => {
      this.onEvent?.({ type: "ended", reason: reason ?? "user_ended" });
    });
    interrupt = vi.fn();
    setMuted = vi.fn();
    sendText = vi.fn();
    getRemoteAudioStream = () => null;
  }
  const holder: { adapter: FakeAdapter | null; created: number } = { adapter: null, created: 0 };
  const apiFetch = vi.fn(async (path: string) => {
    if (path.startsWith("/api/conversations/") && path.endsWith("/end")) {
      return {
        conversation: { id: "22222222-2222-4222-8222-222222222222", connectedSeconds: 65 },
        summary: { id: "s1", content: "You talked about roses." },
        suggestedMemories: [{ id: "m9", content: "Grows roses on the balcony." }],
      };
    }
    if (path === "/api/consent") return { id: "c1" };
    if (path === "/api/preferences") return { preferences: { memoryEnabled: true } };
    if (path.startsWith("/api/memories/")) return { ok: true };
    return { ok: true };
  });
  return { FakeAdapter, holder, apiFetch };
});

vi.mock("@/lib/ai/adapters", () => ({
  createAdapter: () => {
    hoisted.holder.created += 1;
    hoisted.holder.adapter = new hoisted.FakeAdapter();
    return hoisted.holder.adapter;
  },
  isOutputMutable: () => false,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...original, apiFetch: hoisted.apiFetch };
});

vi.mock("@/lib/ai/realtime/audio", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/realtime/audio")>();
  const track = { enabled: true, stop: vi.fn(), kind: "audio" };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  return { ...original, acquireMicrophone: vi.fn(async () => ({ stream })) };
});

import { PreferencesProvider } from "@/components/providers/PreferencesProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { VoiceSession } from "@/components/voice/VoiceSession";

const me: MeResponse = {
  user: { id: "u1", email: null, isDemo: true, demoSlug: "margaret", createdAt: "2026-01-01T00:00:00Z" },
  profile: { userId: "u1", preferredName: "Margaret", companionVoice: "fred", onboardingStage: "named", timezone: null, createdAt: "", updatedAt: "" },
  preferences: {
    userId: "u1",
    humorLevel: "gentle",
    orbColor: "cyan",
    textScale: "large",
    motion: "reduced",
    captions: true,
    pauseSensitivity: "patient",
    modelKey: "full",
    memoryEnabled: false,
    sensitiveMemoryEnabled: false,
    searchEnabled: false,
    updatedAt: "",
  },
  consents: { memory: false, sensitive_memory: false, web_search: false, transcripts: false },
  mode: "demo",
  capabilities: { liveConfigured: false, searchConfigured: false, summariesConfigured: false },
};

function renderSession() {
  return render(
    <PreferencesProvider initialMe={me}>
      <ToastProvider>
        <VoiceSession />
      </ToastProvider>
    </PreferencesProvider>,
  );
}

const emit = (event: AdapterEvent) => act(() => hoisted.holder.adapter?.onEvent?.(event));

beforeEach(() => {
  hoisted.holder.adapter = null;
  hoisted.holder.created = 0;
  hoisted.apiFetch.mockClear();
});
afterEach(() => cleanup());

describe("VoiceSession", () => {
  it("runs the whole flow: start, speak, interrupt, mute, consent, type, end, summary", async () => {
    renderSession();
    expect(screen.getByTestId("simulated-badge").textContent).toMatch(/Simulated — no live AI/);
    expect(screen.getByTestId("status").textContent).toMatch(/Start talking/);

    const start = screen.getByTestId("start-button");
    fireEvent.click(start);
    fireEvent.click(start); // double click: only one adapter
    await waitFor(() => expect(hoisted.holder.adapter?.connect).toHaveBeenCalledTimes(1));
    expect(hoisted.holder.created).toBe(1);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toMatch(/listening whenever/i));
    expect(screen.getByTestId("session-context").textContent).toMatch(/Fred · 1 memory in use/);
    expect(screen.queryByTestId("start-button")).toBeNull();
    expect(screen.queryByTestId("stop-button")).toBeNull();

    // greeting
    emit({ type: "response_started", responseId: "r1" });
    expect(screen.getByTestId("status").textContent).toBe("Thinking");
    emit({ type: "assistant_speech_started", responseId: "r1" });
    emit({ type: "transcript", role: "assistant", itemId: "a1", text: "Hello Margaret", final: false });
    expect(screen.getByTestId("status").textContent).toMatch(/Fred is speaking/);
    expect(screen.getByTestId("orb-stage").dataset.orbState).toBe("speaking");
    const entries = screen.getAllByTestId("transcript-entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].dataset.role).toBe("assistant");

    // interrupt via the Stop button
    fireEvent.click(screen.getByTestId("stop-button"));
    expect(hoisted.holder.adapter?.interrupt).toHaveBeenCalledTimes(1);
    emit({ type: "interrupted", responseId: "r1" });
    emit({ type: "assistant_speech_stopped", responseId: "r1" });
    expect(screen.getByTestId("orb-stage").dataset.orbState).toBe("interrupted");
    expect(screen.queryByTestId("stop-button")).toBeNull();

    // mute toggles aria-pressed and reaches the adapter
    const mute = screen.getByTestId("mute-button");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    expect(screen.getByTestId("mute-button").getAttribute("aria-pressed")).toBe("true");
    expect(hoisted.holder.adapter?.setMuted).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("mute-button"));
    expect(hoisted.holder.adapter?.setMuted).toHaveBeenLastCalledWith(false);

    // consent card from a tool result
    emit({ type: "tool_call", call: { callId: "c1", name: "request_memory_consent", arguments: {} } });
    expect(screen.getByTestId("tool-chip").textContent).toMatch(/Asking permission/);
    emit({
      type: "tool_result",
      call: { callId: "c1", name: "request_memory_consent", arguments: {} },
      result: { output: "shown", uiAction: { type: "consent_prompt", scope: "memory" } },
    });
    expect(screen.getByTestId("consent-card")).toBeTruthy();
    fireEvent.click(screen.getByTestId("consent-yes"));
    await waitFor(() => expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/consent", expect.objectContaining({ method: "POST", json: { scope: "memory", granted: true, source: "ui" } })));
    await waitFor(() => expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/preferences", expect.objectContaining({ method: "PATCH", json: { memoryEnabled: true } })));
    await waitFor(() => expect(screen.queryByTestId("consent-card")).toBeNull());
    expect(hoisted.holder.adapter?.sendText).toHaveBeenCalledWith("Yes, you can remember things about me.");
    expect(screen.getAllByTestId("toast").some((t) => /Memory is on/.test(t.textContent ?? ""))).toBe(true);

    // memory saved toast with undo
    emit({
      type: "tool_result",
      call: { callId: "c2", name: "remember", arguments: {} },
      result: { output: "Saved.", uiAction: { type: "memory_saved", memoryId: "m1", content: "Grows roses" } },
    });
    expect(screen.getAllByTestId("toast").some((t) => /I'll remember: Grows roses/.test(t.textContent ?? ""))).toBe(true);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/memories/m1", { method: "DELETE" }));

    // typed input
    fireEvent.change(screen.getByTestId("text-input"), { target: { value: "What's the weather?" } });
    fireEvent.click(screen.getByTestId("text-send"));
    expect(hoisted.holder.adapter?.sendText).toHaveBeenLastCalledWith("What's the weather?");
    expect((screen.getByTestId("text-input") as HTMLInputElement).value).toBe("");

    // sources render under the assistant entry
    emit({ type: "tool_result", call: { callId: "c3", name: "search_web", arguments: {} }, result: { output: "{}", sources: [{ title: "Met Office", url: "https://www.metoffice.gov.uk/" }] } });
    emit({ type: "transcript", role: "assistant", itemId: "a2", text: "Sunny today.", final: true });
    expect(screen.getByRole("link", { name: "Met Office" }).getAttribute("href")).toBe("https://www.metoffice.gov.uk/");

    // end -> summary
    fireEvent.click(screen.getByTestId("end-button"));
    await waitFor(() => expect(hoisted.holder.adapter?.disconnect).toHaveBeenCalledWith("user_ended"));
    await waitFor(() => expect(screen.getByTestId("session-summary")).toBeTruthy());
    expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/conversations/22222222-2222-4222-8222-222222222222/end", { method: "POST" });
    expect(screen.getByTestId("summary-text").textContent).toBe("You talked about roses.");
    expect(screen.getByTestId("summary-duration").textContent).toBe("1 min 5 sec");
    fireEvent.click(screen.getByTestId("memory-confirm"));
    await waitFor(() => expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/memories/m9", { method: "PATCH", json: { confirm: true } }));
    await waitFor(() => expect(screen.getByText("Kept.")).toBeTruthy());

    // talk again -> back to the start screen
    fireEvent.click(screen.getByTestId("talk-again"));
    expect(screen.getByTestId("start-button")).toBeTruthy();
    expect(screen.queryByTestId("transcript-entry")).toBeNull();
  });

  it("ends cleanly when the adapter ends the session itself (session limit) and shows errors in plain words", async () => {
    renderSession();
    fireEvent.click(screen.getByTestId("start-button"));
    await waitFor(() => expect(hoisted.holder.adapter?.connect).toHaveBeenCalled());
    emit({ type: "error", code: "session_ending_soon", message: "We'll need to wrap up in about two minutes.", recoverable: true });
    expect(screen.getByTestId("status").textContent).toMatch(/wrap up in about two minutes/);
    emit({ type: "ended", reason: "session_limit" });
    await waitFor(() => expect(screen.getByTestId("session-summary")).toBeTruthy());
    expect(hoisted.apiFetch).toHaveBeenCalledWith("/api/conversations/22222222-2222-4222-8222-222222222222/end", { method: "POST" });
  });

  it("shows the model selector and switches with continuation", async () => {
    renderSession();
    fireEvent.click(screen.getByTestId("start-button"));
    await waitFor(() => expect(hoisted.holder.adapter?.connect).toHaveBeenCalled());
    const first = hoisted.holder.adapter;
    fireEvent.change(screen.getByTestId("model-select"), { target: { value: "mini" } });
    await waitFor(() => expect(hoisted.holder.created).toBe(2));
    expect(first?.disconnect).toHaveBeenCalledWith("model_switch");
    const second = hoisted.holder.adapter;
    await waitFor(() => expect(second?.connect).toHaveBeenCalled());
    const opts = second?.connect.mock.calls[0][0] as AdapterConnectOptions;
    expect(opts.modelKey).toBe("mini");
    expect(opts.conversationId).toBe("22222222-2222-4222-8222-222222222222");
    await waitFor(() => expect(screen.getByTestId("model-switch-note").textContent).toMatch(/Switched to Lower cost/));
    expect(screen.queryByTestId("session-summary")).toBeNull();
  });
});
