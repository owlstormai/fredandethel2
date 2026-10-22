"use client";
import { useState, type FormEvent } from "react";
import { Button, MicIcon, MicOffIcon, PauseIcon, cn } from "./integration";

export interface ControlsProps {
  muted: boolean;
  onToggleMute: () => void;
  canInterrupt: boolean;
  onInterrupt: () => void;
  onEnd: () => void;
  ending?: boolean;
  onSendText: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Big, labeled, keyboard-friendly controls (every target >= 56px). */
export function Controls({ muted, onToggleMute, canInterrupt, onInterrupt, onEnd, ending, onSendText, disabled, className }: ControlsProps) {
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSendText(value);
    setText("");
  }

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          size="xl"
          variant={muted ? "primary" : "secondary"}
          data-testid="mute-button"
          aria-pressed={muted}
          onClick={onToggleMute}
          disabled={disabled}
          leadingIcon={muted ? <MicOffIcon /> : <MicIcon />}
          className="min-w-[9.5rem]"
        >
          {muted ? "Unmute" : "Mute"}
        </Button>
        {canInterrupt ? (
          <Button
            size="xl"
            variant="secondary"
            data-testid="stop-button"
            onClick={onInterrupt}
            disabled={disabled}
            leadingIcon={<PauseIcon />}
            className="min-w-[9.5rem] border-accent/50"
          >
            Stop talking
          </Button>
        ) : null}
        <Button
          size="xl"
          variant="danger"
          data-testid="end-button"
          onClick={onEnd}
          loading={ending}
          loadingLabel="Ending"
          className="min-w-[9.5rem]"
        >
          End conversation
        </Button>
      </div>

      <form onSubmit={submit} className="flex w-full flex-col gap-2 sm:flex-row sm:items-end" aria-label="Type a message instead of speaking">
        <label className="flex flex-1 flex-col gap-1.5 text-[1.0625rem] font-medium text-foreground">
          Or type instead
          <input
            data-testid="text-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Type here and press Send"
            className="min-h-14 w-full rounded-[var(--radius-md)] border border-line-strong bg-surface-2 px-4 text-[1.0625rem] text-foreground placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </label>
        <Button type="submit" size="xl" variant="secondary" data-testid="text-send" disabled={disabled || !text.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
