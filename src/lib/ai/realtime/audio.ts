/**
 * Browser audio helpers for the voice session: microphone acquisition with
 * plain-language error mapping, track muting, and remote audio playback.
 *
 * Everything here is browser-only; callers in the server tree must not import
 * it. Functions never throw for expected failures — they return a MicError.
 */

export type MicErrorCode = "denied" | "not_found" | "in_use" | "insecure_context" | "unsupported" | "unknown";

export interface MicError {
  code: MicErrorCode;
  /** Plain-language, older-adult friendly, says what to do next. */
  message: string;
}

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

const MESSAGES: Record<MicErrorCode, string> = {
  denied:
    "The microphone is blocked for this site. Look for a microphone or lock icon near the top of your browser, choose “Allow”, then press Try again.",
  not_found:
    "We couldn't find a microphone. If you use headphones or an external microphone, make sure they are plugged in, then press Try again.",
  in_use:
    "Another program seems to be using the microphone. Close other video or phone apps, then press Try again.",
  insecure_context:
    "Microphones only work on a secure (https) web address. Please open this page using an address that starts with https://.",
  unsupported:
    "This browser can't use the microphone for voice chat. Please try the latest Chrome, Edge, Safari or Firefox.",
  unknown: "Something went wrong while turning on the microphone. Please press Try again, or type instead.",
};

export function describeMicError(code: MicErrorCode): MicError {
  return { code, message: MESSAGES[code] };
}

/** Map a getUserMedia rejection to a MicError (exported for tests). */
export function mapMediaError(error: unknown): MicError {
  const name = (error as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return describeMicError("denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
      return describeMicError("not_found");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return describeMicError("in_use");
    case "TypeError":
      return describeMicError("unsupported");
    default:
      return describeMicError("unknown");
  }
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface AcquireMicrophoneOptions {
  /** Injected for tests. Defaults to navigator.mediaDevices. */
  mediaDevices?: MediaDevicesLike | null;
  /** Injected for tests. Defaults to window.isSecureContext. */
  isSecureContext?: boolean;
}

/**
 * Ask for the microphone with echo cancellation, noise suppression and AGC on.
 * Falls back to plain `{ audio: true }` if the constraints are rejected.
 */
export async function acquireMicrophone(
  options: AcquireMicrophoneOptions = {},
): Promise<{ stream: MediaStream } | { error: MicError }> {
  const secure =
    options.isSecureContext ?? (typeof window !== "undefined" ? window.isSecureContext !== false : true);
  if (!secure) return { error: describeMicError("insecure_context") };

  const devices =
    options.mediaDevices !== undefined
      ? options.mediaDevices
      : typeof navigator !== "undefined"
        ? navigator.mediaDevices ?? null
        : null;
  if (!devices || typeof devices.getUserMedia !== "function") {
    return { error: describeMicError("unsupported") };
  }

  try {
    const stream = await devices.getUserMedia(MIC_CONSTRAINTS);
    return { stream };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      try {
        const stream = await devices.getUserMedia({ audio: true, video: false });
        return { stream };
      } catch (fallbackError) {
        return { error: mapMediaError(fallbackError) };
      }
    }
    return { error: mapMediaError(error) };
  }
}

/** Enable/disable every audio track (muting keeps the track alive so unmute is instant). */
export function setTrackEnabled(stream: MediaStream | null | undefined, enabled: boolean): void {
  if (!stream) return;
  for (const track of stream.getAudioTracks()) track.enabled = enabled;
}

/** Stop and release every track. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Create a hidden <audio> element bound to a remote stream. Attaching to the
 * DOM matters: Chrome will not route a remote WebRTC track into Web Audio
 * (the orb analyser) unless a media element is playing it.
 */
export function createRemoteAudioElement(stream: MediaStream, doc: Document = document): HTMLAudioElement {
  const el = doc.createElement("audio");
  el.autoplay = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("aria-hidden", "true");
  el.style.position = "absolute";
  el.style.width = "0";
  el.style.height = "0";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.dataset.companionRemoteAudio = "true";
  el.srcObject = stream;
  doc.body.appendChild(el);
  return el;
}

/** Detach and release a remote audio element created above. */
export function removeAudioElement(el: HTMLAudioElement | null | undefined): void {
  if (!el) return;
  try {
    el.pause();
  } catch {
    /* ignore */
  }
  el.srcObject = null;
  el.remove();
}

const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Try to play; if the browser blocks autoplay, retry on the next user gesture.
 * Resolves true when playback started, false when it is still waiting.
 */
export async function ensureAudioPlayback(el: HTMLAudioElement, doc: Document = document): Promise<boolean> {
  try {
    await el.play();
    return true;
  } catch {
    return new Promise<boolean>((resolve) => {
      const retry = async () => {
        for (const name of GESTURE_EVENTS) doc.removeEventListener(name, retry, true);
        try {
          await el.play();
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      for (const name of GESTURE_EVENTS) doc.addEventListener(name, retry, { capture: true, once: true });
    });
  }
}
