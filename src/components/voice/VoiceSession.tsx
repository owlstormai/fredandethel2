"use client";
/**
 * VoiceSession — the main talking experience. The orb is the hero; everything
 * else is large, labeled and keyboard reachable. Mode comes from the signed-in
 * user's effective mode (demo users are always demo). Demo mode shows a
 * persistent "Simulated — no live AI" badge.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { connectedSeconds, describeStatus, describeTool } from "@/lib/ai/realtime/conversationState";
import type { UiAction } from "@/lib/ai/tools/clientDispatcher";
import { apiFetch } from "@/lib/api/client";
import type { ConsentScope, ModelKey, Preferences } from "@/lib/types";
import { ConsentCard, type ConsentCardScope } from "./ConsentCard";
import { Controls } from "./Controls";
import { MicPermissionHelp } from "./MicPermissionHelp";
import { ModelSwitcher } from "./ModelSwitcher";
import { SessionSummary } from "./SessionSummary";
import { StatusLine } from "./StatusLine";
import { Transcript } from "./Transcript";
import { Badge, Button, Orb, Spinner, cn, useAudioLevel, usePreferences, useReducedMotion, useToast } from "./integration";
import { useConversation } from "./useConversation";

const CONSENT_PREFERENCE: Record<ConsentCardScope, keyof Pick<Preferences, "memoryEnabled" | "sensitiveMemoryEnabled" | "searchEnabled">> = {
  memory: "memoryEnabled",
  sensitive_memory: "sensitiveMemoryEnabled",
  web_search: "searchEnabled",
};
const CONSENT_TOAST: Record<ConsentCardScope, string> = {
  memory: "Memory is on",
  sensitive_memory: "I can remember personal topics too",
  web_search: "I can look things up for you now",
};
const CONSENT_SPOKEN: Record<ConsentCardScope, string> = {
  memory: "Yes, you can remember things about me.",
  sensitive_memory: "Yes, you can remember personal topics too.",
  web_search: "Yes, you can look things up online for me.",
};

export function VoiceSession() {
  const { me, loading, error: meError, update, refresh } = usePreferences();
  const reducedMotion = useReducedMotion();
  const { toast } = useToast();

  const mode = me?.mode ?? "demo";
  const companionVoice = me?.profile.companionVoice ?? "fred";
  const companionName = companionVoice === "ethel" ? "Ethel" : "Fred";
  const pauseSensitivity = me?.preferences.pauseSensitivity ?? "patient";
  const captions = me?.preferences.captions ?? true;
  const orbColor = me?.preferences.orbColor ?? "cyan";
  const preferredModel: ModelKey = me?.preferences.modelKey ?? "full";

  const [consentPrompt, setConsentPrompt] = useState<ConsentCardScope | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const conversationRef = useRef<ReturnType<typeof useConversation> | null>(null);

  const onUiAction = useCallback(
    (action: UiAction) => {
      switch (action.type) {
        case "consent_prompt":
          setConsentPrompt(action.scope);
          break;
        case "memory_saved":
          toast({
            title: `I'll remember: ${action.content}`,
            variant: "success",
            duration: 9000,
            description: (
              <button
                type="button"
                className="mt-1 inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[1rem] font-medium text-foreground hover:bg-surface-2"
                onClick={() => {
                  void apiFetch(`/api/memories/${encodeURIComponent(action.memoryId)}`, { method: "DELETE" })
                    .then(() => toast({ title: "Okay, forgotten.", duration: 4000 }))
                    .catch(() => toast({ title: "I couldn't undo that just now.", variant: "error" }));
                }}
              >
                Undo
              </button>
            ),
          });
          break;
        case "memory_deleted":
          toast({ title: "Forgotten. It won't come back.", duration: 5000 });
          break;
        case "humor_changed":
          toast({ title: action.level === "off" ? "No more joking." : action.level === "gentle" ? "I'll keep the humor gentle." : "Playful it is." });
          void refresh();
          break;
        case "name_set":
          toast({ title: `Nice to meet you, ${action.name}.` });
          void refresh();
          break;
        case "end_conversation":
          break; // the hook ends after the goodbye
      }
    },
    [toast, refresh],
  );

  const conversation = useConversation({
    mode,
    modelKey: preferredModel,
    companionVoice,
    pauseSensitivity,
    onUiAction,
  });
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  const { state, micStream, remoteStream, start, end, interrupt, toggleMute, sendText, switchModel, summary, starting, ending, switchNote, clearSwitchNote, reset } = conversation;

  const micLevelRaw = useAudioLevel(micStream);
  const remoteLevel = useAudioLevel(remoteStream);
  const micLevel = state.muted ? 0 : micLevelRaw;
  const outputLevel = remoteStream ? remoteLevel : state.outputLevel;

  // Model switch note fades after a while.
  useEffect(() => {
    if (!switchNote) return;
    const id = setTimeout(clearSwitchNote, 12_000);
    return () => clearTimeout(id);
  }, [switchNote, clearSwitchNote]);

  const handleConsent = useCallback(
    async (granted: boolean) => {
      const scope = consentPrompt;
      if (!scope) return;
      if (!granted) {
        setConsentPrompt(null);
        return;
      }
      setConsentBusy(true);
      try {
        await apiFetch("/api/consent", { method: "POST", json: { scope: scope as ConsentScope, granted: true, source: "ui" } });
        await update({ [CONSENT_PREFERENCE[scope]]: true } as Partial<Preferences>);
        toast({ title: CONSENT_TOAST[scope], variant: "success" });
        // Let the companion know in the conversation itself.
        conversationRef.current?.sendText(CONSENT_SPOKEN[scope]);
        setConsentPrompt(null);
      } catch {
        toast({ title: "I couldn't save that choice just now. Please try again.", variant: "error" });
      } finally {
        setConsentBusy(false);
      }
    },
    [consentPrompt, update, toast],
  );

  const statusText = describeStatus(state, companionName);
  const statusTone = state.lastError && !state.lastError.recoverable ? "error" : state.lastError?.recoverable && state.connection === "connected" ? "warning" : "normal";
  const connected = state.connection === "connected" || state.connection === "reconnecting";
  const active = connected || state.connection === "connecting" || state.connection === "requesting_mic";
  // A consent card only makes sense while connected; a stale one is dropped on the next start.
  const consentVisible = consentPrompt && connected ? consentPrompt : null;
  const showSummary = state.connection === "ended" && !ending;
  const simulated = state.session?.simulated ?? mode === "demo";
  const toolChip = describeTool(state.activeTool);

  if (loading && !me) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Spinner label="Loading your settings" className="text-2xl text-muted" />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center gap-5" data-testid="voice-session" data-mode={mode}>
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {simulated ? (
            <Badge variant="simulated" size="md" data-testid="simulated-badge">
              Simulated — no live AI
            </Badge>
          ) : (
            <Badge variant="accent" size="md">Live voice</Badge>
          )}
          {state.session ? (
            <span className="text-[0.95rem] text-subtle" data-testid="session-context">
              {state.session.voiceLabel} · {state.session.context.memoryCount} {state.session.context.memoryCount === 1 ? "memory" : "memories"} in use
            </span>
          ) : null}
        </div>
        <ModelSwitcher
          value={conversation.modelKey}
          onChange={(key) => void switchModel(key)}
          disabled={starting || ending}
          connected={connected}
          className="w-full sm:w-auto sm:min-w-[16rem]"
        />
      </div>
      {switchNote ? (
        <p role="status" data-testid="model-switch-note" className="w-full rounded-[var(--radius-md)] bg-surface-2 px-4 py-2 text-[1rem] text-muted">
          {switchNote}
        </p>
      ) : null}
      {meError ? <p className="text-[1rem] text-warning">{meError}</p> : null}

      {showSummary ? (
        <SessionSummary summary={summary} connectedSeconds={connectedSeconds(state)} simulated={simulated} onTalkAgain={reset} />
      ) : (
        <>
          <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 py-2">
            <div data-testid="orb-stage" data-orb-state={state.orb} className="flex items-center justify-center">
              <Orb
                state={state.orb}
                micLevel={micLevel}
                outputLevel={outputLevel}
                color={orbColor}
                size="fluid"
                reducedMotion={reducedMotion}
                label={`${companionName}: ${statusText}`}
              />
            </div>
            <StatusLine text={statusText} tone={statusTone} />
            {toolChip ? (
              <Badge variant="accent" size="md" data-testid="tool-chip" className="animate-pulse-soft">
                {toolChip}
              </Badge>
            ) : null}
          </div>

          {state.micError && !active ? (
            <MicPermissionHelp
              error={state.micError}
              busy={starting}
              onRetry={() => void start()}
              onContinueWithoutMic={() => void start({ skipMic: true })}
            />
          ) : null}

          {consentVisible ? <ConsentCard scope={consentVisible} busy={consentBusy} onYes={() => void handleConsent(true)} onNotNow={() => void handleConsent(false)} /> : null}

          {!active ? (
            <div className="flex w-full flex-col items-center gap-3">
              <Button
                size="xl"
                variant="primary"
                data-testid="start-button"
                onClick={() => {
                  setConsentPrompt(null);
                  void start();
                }}
                loading={starting} loadingLabel="Starting" className="w-full max-w-md text-[1.25rem]">
                Start talking
              </Button>
              <p className="text-center text-[1rem] text-subtle">
                {mode === "demo" ? "The demo companion talks with your browser's voice — nothing is sent to a live AI." : `You'll talk with ${companionName}. Just speak naturally; pauses are fine.`}
              </p>
            </div>
          ) : (
            <Controls
              muted={state.muted}
              onToggleMute={toggleMute}
              canInterrupt={state.assistantSpeaking}
              onInterrupt={interrupt}
              onEnd={() => void end("user_ended")}
              ending={ending}
              onSendText={sendText}
              disabled={state.connection === "connecting" || state.connection === "requesting_mic"}
            />
          )}

          {captions && (active || state.transcript.length > 0) ? (
            <Transcript entries={state.transcript} companionName={companionName} userName={me?.profile.preferredName} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** Small helper for pages that want to show the orb-only hero while loading. */
export function VoiceSessionFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex w-full flex-1 flex-col", className)}>{children}</div>;
}
