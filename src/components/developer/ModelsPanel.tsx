"use client";
/** Model configs, env overrides and the API verification summary (with deprecation warnings). */
import type { VerificationResponse } from "@/app/api/verification/route";
import type { ModelsResponse } from "@/lib/api/contracts";
import { Badge, DevCard, ErrorNote, KeyValue, Loading } from "./primitives";
import { useJson } from "./useJson";

const ROLE_LABEL: Record<VerificationResponse["modelsInUse"][number]["role"], string> = {
  realtime_full: "Realtime (full)",
  realtime_mini: "Realtime (mini)",
  transcription: "Input transcription",
  text: "Summaries (text)",
  search: "Web search (text)",
};

export function ModelsPanel() {
  const models = useJson<ModelsResponse>("/api/models");
  const verification = useJson<VerificationResponse>("/api/verification");

  return (
    <DevCard id="models" title="Models & verification">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-400">model_configs (effective)</h3>
          {models.loading && !models.data ? <Loading label="models" /> : null}
          {models.error ? <ErrorNote error={models.error} /> : null}
          {models.data ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Model configurations</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="py-1 pr-2">Key</th>
                  <th scope="col" className="py-1 pr-2">Model ID</th>
                  <th scope="col" className="py-1 pr-2">Audio in/out</th>
                  <th scope="col" className="py-1 pr-2">Text in/out</th>
                  <th scope="col" className="py-1">State</th>
                </tr>
              </thead>
              <tbody>
                {models.data.models.map((m) => (
                  <tr key={m.key} className="border-t border-white/5 font-mono">
                    <th scope="row" className="py-1 pr-2 text-left font-normal">
                      {m.key}
                      {models.data?.defaultKey === m.key ? <span className="ml-1 text-xs text-cyan-200">(your default)</span> : null}
                    </th>
                    <td className="py-1 pr-2">{m.modelId}</td>
                    <td className="py-1 pr-2">
                      ${m.pricing.audioInput} / ${m.pricing.audioOutput}
                    </td>
                    <td className="py-1 pr-2">
                      ${m.pricing.textInput} / ${m.pricing.textOutput}
                    </td>
                    <td className="py-1">{m.enabled ? <Badge tone="ok">enabled</Badge> : <Badge tone="danger">disabled</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p className="mt-1 text-xs text-slate-400">Prices are USD per 1M tokens. DB rows override defaults in src/lib/ai/models.ts.</p>
        </div>

        <div>
          <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-400">Models in use (env overrides)</h3>
          {verification.loading && !verification.data ? <Loading label="verification" /> : null}
          {verification.error ? <ErrorNote error={verification.error} /> : null}
          {verification.data ? (
            <>
              <table className="w-full text-sm">
                <caption className="sr-only">Models in use and their environment overrides</caption>
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th scope="col" className="py-1 pr-2">Role</th>
                    <th scope="col" className="py-1 pr-2">Model ID</th>
                    <th scope="col" className="py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {verification.data.modelsInUse.map((m) => (
                    <tr key={m.role} className="border-t border-white/5">
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-300">{ROLE_LABEL[m.role]}</th>
                      <td className="py-1 pr-2 font-mono">
                        {m.id} {m.deprecation ? <Badge tone="danger">deprecated</Badge> : null}
                      </td>
                      <td className="py-1 text-xs">
                        {m.overridden ? (
                          <Badge tone="info">{m.envVar}</Badge>
                        ) : (
                          <span className="text-slate-400">default</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {verification.data.warnings.length > 0 ? (
                <ul role="alert" className="mt-2 space-y-1 rounded border border-amber-400/40 bg-amber-400/5 p-2 text-sm text-amber-100">
                  {verification.data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-emerald-200">No deprecated models in use.</p>
              )}

              <h3 className="mb-1 mt-4 text-xs uppercase tracking-wide text-slate-400">Verified facts</h3>
              <KeyValue
                rows={[
                  ["Verified on", verification.data.verifiedOn],
                  ["Source", verification.data.source],
                  ["Mint secret", verification.data.facts.clientSecretsEndpoint],
                  ["WebRTC SDP", verification.data.facts.callsEndpoint],
                  ["Data channel", verification.data.facts.dataChannel],
                  ["Ephemeral TTL", `${verification.data.facts.ephemeralTtlSeconds}s (allowed ${verification.data.facts.ephemeralTtlRangeSeconds.join("–")}s)`],
                  ["Session max", `${verification.data.facts.realtimeMaxSessionMinutes} min`],
                  ["VAD mode", verification.data.vadMode === "semantic" ? "semantic_vad (eagerness by pause setting)" : "server_vad fallback"],
                  ["Realtime web search", verification.data.facts.realtimeHasBuiltInWebSearch ? "built in" : "none; via Responses web_search"],
                  ["Search cost", `$${verification.data.facts.webSearchPricePerCallUsd.toFixed(3)} per call + model tokens`],
                  ["Audio tokens", `${verification.data.facts.audioTokensPerSecond.input}/s in, ${verification.data.facts.audioTokensPerSecond.output}/s out`],
                ]}
              />

              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-300">Unverified items ({verification.data.unverified.length})</summary>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-400">
                  {verification.data.unverified.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </details>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-slate-300">Known deprecations ({verification.data.deprecations.length})</summary>
                <table className="mt-1 w-full text-xs">
                  <caption className="sr-only">Known model deprecations</caption>
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th scope="col" className="pr-2">Model</th>
                      <th scope="col" className="pr-2">Shutdown</th>
                      <th scope="col">Replacement</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {verification.data.deprecations.map((d) => (
                      <tr key={d.id} className="border-t border-white/5">
                        <td className="py-0.5 pr-2">{d.id}</td>
                        <td className="py-0.5 pr-2">{d.shutdown}</td>
                        <td className="py-0.5">{d.replacement}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : null}
        </div>
      </div>
    </DevCard>
  );
}
