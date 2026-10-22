"use client";
/** Which mode this account runs in and whether live features are configured server-side. */
import type { MeResponse } from "@/lib/api/contracts";
import { Badge, DevCard, ErrorNote, KeyValue, Loading } from "./primitives";
import { useJson } from "./useJson";

export function ModeCard({ user }: { user: { id: string; isDemo: boolean; email: string | null } }) {
  const me = useJson<MeResponse>("/api/me");
  const caps = me.data?.capabilities;

  return (
    <DevCard id="mode" title="Mode">
      {me.loading && !me.data ? <Loading label="mode" /> : null}
      {me.error ? <ErrorNote error={me.error} /> : null}
      <KeyValue
        rows={[
          ["Account", user.isDemo ? <Badge tone="warn">demo profile</Badge> : <Badge tone="ok">registered</Badge>],
          [
            "Effective mode",
            me.data ? (
              me.data.mode === "live" ? <Badge tone="ok">live</Badge> : <Badge tone="warn">demo (simulated)</Badge>
            ) : (
              <span className="text-slate-400">—</span>
            ),
          ],
          ["liveConfigured", caps ? String(caps.liveConfigured) : "—"],
          ["searchConfigured", caps ? String(caps.searchConfigured) : "—"],
          ["summariesConfigured", caps ? String(caps.summariesConfigured) : "—"],
          ["Model key", me.data?.preferences.modelKey ?? "—"],
          ["Pause sensitivity", me.data?.preferences.pauseSensitivity ?? "—"],
          ["Humor", me.data?.preferences.humorLevel ?? "—"],
          ["Memory", me.data ? String(me.data.preferences.memoryEnabled) : "—"],
          ["Search pref / consent", me.data ? `${me.data.preferences.searchEnabled} / ${me.data.consents.web_search}` : "—"],
        ]}
      />
      <p className="mt-2 text-xs text-slate-400">
        Secrets never reach the browser: these flags are booleans computed server-side. Demo profiles never call the paid API.
      </p>
    </DevCard>
  );
}
