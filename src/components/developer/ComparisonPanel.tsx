"use client";
/** Side-by-side model comparison plus a plain explanation of what switching does and does not carry over. */
// TODO(integration): switch to "@/components/voice/ComparisonSession" (Agent B) and delete the stub.
import { ComparisonSession } from "@/components/voice/ComparisonSession";
import { DevCard } from "./primitives";

export function ComparisonPanel() {
  return (
    <DevCard id="comparison" title="Model comparison">
      <div className="mb-3 space-y-2 text-sm text-slate-300">
        <p>
          <strong className="text-slate-100">What a switch does:</strong> the browser ends the current Realtime session,
          the server mints a new client secret for the other model and re-injects <em>application-owned</em> context:
          saved memories (confirmed/reported only), recent summaries minus tombstoned content, and the tail of the
          conversation transcript (<code className="font-mono">continueConversationId</code>). The new conversation row
          records <code className="font-mono">continued_from_id</code>.
        </p>
        <p>
          <strong className="text-slate-100">What it cannot do:</strong> carry hidden model state across models. Anything
          the first model &ldquo;knew&rdquo; only from audio it heard is gone unless our transcript captured it. The
          voice stays the same (Fred/Ethel map to the same OpenAI voice on both models).
        </p>
        <p>
          <strong className="text-slate-100">Fair comparison:</strong> both models receive the same instructions, tools,
          memory block and VAD settings; the only variable is <code className="font-mono">session.model</code>. Costs
          are recorded per model so the usage card above can show the difference.
        </p>
      </div>
      <ComparisonSession />
    </DevCard>
  );
}
