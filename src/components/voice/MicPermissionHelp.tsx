"use client";
import type { MicError } from "@/lib/ai/realtime/audio";
import { Button, Card } from "./integration";

const TITLES: Record<MicError["code"], string> = {
  denied: "The microphone is blocked",
  not_found: "No microphone found",
  in_use: "The microphone is busy",
  insecure_context: "This page needs a secure address",
  unsupported: "This browser can't use the microphone",
  unknown: "The microphone didn't turn on",
};

export interface MicPermissionHelpProps {
  error: MicError;
  onRetry: () => void;
  onContinueWithoutMic: () => void;
  busy?: boolean;
}

export function MicPermissionHelp({ error, onRetry, onContinueWithoutMic, busy }: MicPermissionHelpProps) {
  return (
    <Card as="section" role="alert" data-testid="mic-help" title={TITLES[error.code]} description={error.message} padding="md" className="w-full border-warning/40">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="xl" variant="primary" onClick={onRetry} loading={busy} data-testid="mic-retry" className="flex-1">
          Try again
        </Button>
        <Button size="xl" variant="secondary" onClick={onContinueWithoutMic} disabled={busy} data-testid="mic-skip" className="flex-1">
          Continue by typing
        </Button>
      </div>
    </Card>
  );
}
