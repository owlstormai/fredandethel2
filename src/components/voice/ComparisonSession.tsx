"use client";
/**
 * ComparisonSession — developer side-by-side mode. Two live adapters (full and
 * mini) share ONE microphone stream; only one is audible at a time. Shows each
 * model's transcript, per-response latency (response_started -> first audio) and
 * a local cost ESTIMATE from REALTIME_PRICING. Live mode only.
 */
import { useCallback, useMemo, useState } from "react";
import { REALTIME_PRICING } from "@/lib/ai/models";
import { acquireMicrophone, stopStream, type MicError } from "@/lib/ai/realtime/audio";
import { estimateRealtimeCostUsd, formatUsd } from "@/lib/ai/realtime/costEstimate";
import { describeStatus, type ConversationState } from "@/lib/ai/realtime/conversationState";
import type { ModelKey } from "@/lib/types";
import { MicPermissionHelp } from "./MicPermissionHelp";
import { Transcript } from "./Transcript";
import { Badge, Button, Card, Orb, cn, usePreferences, useReducedMotion } from "./integration";
import { MODEL_LABELS, useConversation } from "./useConversation";

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ColumnStats({ state, modelKey }: { state: ConversationState; modelKey: ModelKey }) {
  const cost = estimateRealtimeCostUsd(state.usage, REALTIME_PRICING[modelKey]);
  const avg = average(state.latenciesMs);
  const last = state.latenciesMs.length ? state.latenciesMs[state.latenciesMs.length - 1] : null;
  return (
    <dl className="grid grid-cols-2 gap-2 text-[0.95rem]" data-testid={`compare-stats-${modelKey}`}>
      <div className="rounded-[var(--radius-md)] bg-surface-2 p-2">
        <dt className="text-subtle">Responses</dt>
        <dd className="text-foreground">{state.responses}</dd>
      </div>
      <div className="rounded-[var(--radius-md)] bg-surface-2 p-2">
        <dt className="text-subtle">Latency (last / avg)</dt>
        <dd className="text-foreground">
          {last !== null ? `${Math.round(last)} ms` : "—"} / {avg !== null ? `${Math.round(avg)} ms` : "—"}
        </dd>
      </div>
      <div className="rounded-[var(--radius-md)] bg-surface-2 p-2">
        <dt className="text-subtle">Audio in / out tokens</dt>
        <dd className="text-foreground">
          {state.usage.inputAudioTokens} / {state.usage.outputAudioTokens}
        </dd>
      </div>
      <div className="rounded-[var(--radius-md)] bg-surface-2 p-2">
        <dt className="text-subtle">Text in / out tokens</dt>
        <dd className="text-foreground">
          {state.usage.inputTextTokens} / {state.usage.outputTextTokens}
        </dd>
      </div>
      <div className="col-span-2 rounded-[var(--radius-md)] bg-accent-soft p-2">
        <dt className="text-subtle">Estimated cost (local estimate, not a bill)</dt>
        <dd className="text-foreground" data-testid={`compare-cost-${modelKey}`}>{formatUsd(cost)}</dd>
      </div>
    </dl>
  );
}

export function ComparisonSession() {
  const { me } = usePreferences();
  const reducedMotion = useReducedMotion();
  const mode = me?.mode ?? "demo";
  const companionVoice = me?.profile.companionVoice ?? "fred";
  const companionName = companionVoice === "ethel" ? "Ethel" : "Fred";
  const pauseSensitivity = me?.preferences.pauseSensitivity ?? "patient";

  const [audible, setAudible] = useState<ModelKey>("full");
  const [sharedMic, setSharedMic] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<MicError | null>(null);
  const [busy, setBusy] = useState(false);

  const full = useConversation({ mode, modelKey: "full", companionVoice, pauseSensitivity, outputMuted: audible !== "full" });
  const mini = useConversation({ mode, modelKey: "mini", companionVoice, pauseSensitivity, outputMuted: audible !== "mini" });

  const running = full.state.connection === "connected" || mini.state.connection === "connected";
  const starting = busy || full.starting || mini.starting;

  const startBoth = useCallback(async () => {
    if (starting || running) return;
    setBusy(true);
    setMicError(null);
    try {
      const result = await acquireMicrophone();
      if ("error" in result) {
        setMicError(result.error);
        return;
      }
      setSharedMic(result.stream);
      await Promise.all([full.start({ micStream: result.stream }), mini.start({ micStream: result.stream })]);
    } finally {
      setBusy(false);
    }
  }, [starting, running, full, mini]);

  const endBoth = useCallback(async () => {
    await Promise.all([full.end("user_ended"), mini.end("user_ended")]);
    stopStream(sharedMic);
    setSharedMic(null);
  }, [full, mini, sharedMic]);

  const sendBoth = useCallback(
    (text: string) => {
      full.sendText(text);
      mini.sendText(text);
    },
    [full, mini],
  );

  const columns = useMemo(
    () => [
      { key: "full" as ModelKey, conv: full },
      { key: "mini" as ModelKey, conv: mini },
    ],
    [full, mini],
  );

  if (mode !== "live") {
    return (
      <Card as="section" title="Side-by-side comparison needs live mode" padding="md" data-testid="comparison-unavailable">
        <p className="text-[1.0625rem] leading-relaxed text-muted">
          Comparison runs two real Realtime sessions (full quality and lower cost) against the same microphone and shows their
          transcripts, response latency and estimated cost next to each other. The demo companion is simulated and has a single
          brain, so there is nothing meaningful to compare. Sign in with a non-demo account on a server with an OpenAI API key
          to use it.
        </p>
      </Card>
    );
  }

  return (
    <section className="flex w-full flex-col gap-4" data-testid="comparison-session">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent" size="md">Developer comparison</Badge>
          <span className="text-[0.95rem] text-subtle">One microphone, two models. Costs are estimates.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!running ? (
            <Button size="lg" variant="primary" onClick={() => void startBoth()} loading={starting} data-testid="compare-start">
              Start both
            </Button>
          ) : (
            <>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => setAudible((a) => (a === "full" ? "mini" : "full"))}
                data-testid="compare-swap"
                aria-label={`Swap which one you hear (now hearing ${MODEL_LABELS[audible]})`}
              >
                Swap which one you hear
              </Button>
              <Button size="lg" variant="danger" onClick={() => void endBoth()} loading={full.ending || mini.ending} data-testid="compare-end">
                End both
              </Button>
            </>
          )}
        </div>
      </div>

      {micError && !running ? (
        <MicPermissionHelp error={micError} onRetry={() => void startBoth()} onContinueWithoutMic={() => setMicError(null)} busy={starting} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {columns.map(({ key, conv }) => {
          const hearing = audible === key;
          return (
            <Card
              key={key}
              as="article"
              padding="md"
              title={
                <span className="flex items-center gap-2">
                  {MODEL_LABELS[key]}
                  {hearing ? <Badge variant="success">You hear this one</Badge> : <Badge variant="outline">Muted</Badge>}
                </span>
              }
              description={conv.state.session?.modelId ?? "not connected"}
              data-testid={`compare-column-${key}`}
              className={cn(hearing && "border-accent/40")}
            >
              <div className="mb-3 flex items-center gap-3">
                <Orb state={conv.state.orb} micLevel={0} outputLevel={conv.state.outputLevel} size={72} reducedMotion={reducedMotion} />
                <p className="text-[1rem] text-muted" aria-live="polite">
                  {describeStatus(conv.state, companionName)}
                </p>
              </div>
              <ColumnStats state={conv.state} modelKey={key} />
              <Transcript entries={conv.state.transcript} companionName={companionName} className="mt-3 max-h-[30vh]" />
            </Card>
          );
        })}
      </div>

      {running ? (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("compare-text") as HTMLInputElement | null);
            const value = input?.value.trim();
            if (value) {
              sendBoth(value);
              if (input) input.value = "";
            }
          }}
        >
          <label className="flex flex-1 flex-col gap-1.5 text-[1rem] font-medium text-foreground">
            Send the same text to both
            <input name="compare-text" type="text" autoComplete="off" className="min-h-12 rounded-[var(--radius-md)] border border-line-strong bg-surface-2 px-4 text-[1rem] text-foreground" />
          </label>
          <Button type="submit" size="lg" variant="secondary">
            Send to both
          </Button>
        </form>
      ) : null}
    </section>
  );
}
