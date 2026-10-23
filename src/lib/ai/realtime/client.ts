/**
 * RealtimeWebRTCClient — the thinnest possible WebRTC transport to the OpenAI
 * Realtime API (GA). Verified flow (docs/API_VERIFICATION.md §2):
 *
 *   pc = new RTCPeerConnection()
 *   pc.ontrack -> remote audio stream
 *   pc.addTrack(mic)
 *   dc = pc.createDataChannel("oai-events")
 *   offer = await pc.createOffer(); await pc.setLocalDescription(offer)
 *   POST <callsUrl> body=offer.sdp
 *        headers: Authorization: Bearer <ephemeral client secret>, Content-Type: application/sdp
 *        (NO OpenAI-Beta header, NO ?model= query — the model lives in the server-minted session)
 *   await pc.setRemoteDescription({ type: "answer", sdp: await res.text() })
 *
 * Dependency-free and unit-testable: RTCPeerConnection and fetch are injectable.
 */
import type { RealtimeClientEvent, RealtimeServerEvent } from "./events";
import { parseServerEvent } from "./events";

export type RealtimeConnectErrorCode =
  | "aborted"
  | "sdp_rejected"
  | "network"
  | "timeout"
  | "peer_failed"
  | "unsupported";

export class RealtimeConnectError extends Error {
  constructor(
    public readonly code: RealtimeConnectErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RealtimeConnectError";
  }
}

export type TransportState = "idle" | "connecting" | "open" | "closed";

export interface RealtimeConnectParams {
  clientSecret: string;
  callsUrl: string;
  micStream: MediaStream | null;
  onServerEvent: (event: RealtimeServerEvent) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceConnectionState?: (state: RTCIceConnectionState) => void;
  /** Fired when the data channel closes for any reason after it was open. */
  onDataChannelClose?: () => void;
  signal?: AbortSignal;
}

/** Minimal transport surface the adapter depends on (so tests can fake it). */
export interface RealtimeTransport {
  readonly state: TransportState;
  readonly remoteStream: MediaStream | null;
  connect(params: RealtimeConnectParams): Promise<void>;
  send(event: RealtimeClientEvent): void;
  close(): void;
}

export interface RealtimeWebRTCClientOptions {
  /** Injected for tests. */
  RTCPeerConnection?: typeof RTCPeerConnection;
  /** Injected for tests. */
  fetch?: typeof fetch;
  rtcConfiguration?: RTCConfiguration;
  /** Default 15s. */
  dataChannelOpenTimeoutMs?: number;
}

const DATA_CHANNEL_LABEL = "oai-events";

export class RealtimeWebRTCClient implements RealtimeTransport {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private queue: RealtimeClientEvent[] = [];
  private _state: TransportState = "idle";
  private _remoteStream: MediaStream | null = null;
  private readonly PeerConnectionCtor: typeof RTCPeerConnection | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly rtcConfiguration: RTCConfiguration | undefined;
  private readonly openTimeoutMs: number;
  /** Rejects the in-flight waitForOpen() promise; set while connecting, cleared once it settles. */
  private settlePendingOpen: ((error: RealtimeConnectError) => void) | null = null;

  constructor(options: RealtimeWebRTCClientOptions = {}) {
    this.PeerConnectionCtor =
      options.RTCPeerConnection ?? (typeof RTCPeerConnection !== "undefined" ? RTCPeerConnection : undefined);
    this.fetchImpl = options.fetch ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
    this.rtcConfiguration = options.rtcConfiguration;
    this.openTimeoutMs = options.dataChannelOpenTimeoutMs ?? 15_000;
  }

  get state(): TransportState {
    return this._state;
  }

  get remoteStream(): MediaStream | null {
    return this._remoteStream;
  }

  /** Exposed for diagnostics; null until connect() runs. */
  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  async connect(params: RealtimeConnectParams): Promise<void> {
    if (this._state !== "idle") throw new RealtimeConnectError("peer_failed", "Client already used; create a new one.");
    if (!this.PeerConnectionCtor) throw new RealtimeConnectError("unsupported", "WebRTC is not available in this browser.");
    if (!this.fetchImpl) throw new RealtimeConnectError("unsupported", "fetch is not available.");
    const { signal } = params;
    if (signal?.aborted) throw new RealtimeConnectError("aborted", "Connection cancelled.");

    this._state = "connecting";
    const pc = new this.PeerConnectionCtor(this.rtcConfiguration);
    this.pc = pc;

    pc.ontrack = (event: RTCTrackEvent) => {
      const stream = event.streams?.[0] ?? new MediaStream([event.track]);
      this._remoteStream = stream;
      params.onRemoteStream?.(stream);
    };
    pc.onconnectionstatechange = () => params.onConnectionState?.(pc.connectionState);
    pc.oniceconnectionstatechange = () => params.onIceConnectionState?.(pc.iceConnectionState);

    const micTrack = params.micStream?.getAudioTracks()[0] ?? null;
    if (micTrack) {
      pc.addTrack(micTrack, params.micStream as MediaStream);
    } else {
      // No microphone (typing only): still negotiate an audio line so we can hear the assistant.
      pc.addTransceiver("audio", { direction: "recvonly" });
    }

    // Create the data channel BEFORE the offer so the SDP includes it.
    const dc = pc.createDataChannel(DATA_CHANNEL_LABEL);
    this.dc = dc;
    dc.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : null;
      if (!data) return;
      const parsed = parseServerEvent(data);
      if (parsed) params.onServerEvent(parsed);
    };

    const opened = this.waitForOpen(dc, pc, signal);
    // If connect() fails before `await opened` (SDP refused, network), the promise
    // still settles later (close() or the open timeout); this keeps that from
    // surfacing as an unhandled rejection. `await opened` below still sees it.
    opened.catch(() => {});

    try {
      const offer = await pc.createOffer();
      this.throwIfAborted(signal);
      await pc.setLocalDescription(offer);
      this.throwIfAborted(signal);

      let response: Response;
      try {
        response = await this.fetchImpl(params.callsUrl, {
          method: "POST",
          body: offer.sdp ?? "",
          headers: {
            Authorization: `Bearer ${params.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw new RealtimeConnectError("aborted", "Connection cancelled.");
        throw new RealtimeConnectError("network", `Could not reach the voice service: ${(error as Error).message}`);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new RealtimeConnectError(
          "sdp_rejected",
          `The voice service refused the connection (HTTP ${response.status}).${text ? ` ${text.slice(0, 300)}` : ""}`,
          response.status,
        );
      }
      const answerSdp = await response.text();
      this.throwIfAborted(signal);
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await opened;
      this._state = "open";
      this.flushQueue();
      dc.onclose = () => {
        if (this._state === "open") {
          this._state = "closed";
          params.onDataChannelClose?.();
        }
      };
    } catch (error) {
      this.close();
      if (error instanceof RealtimeConnectError) throw error;
      if (signal?.aborted) throw new RealtimeConnectError("aborted", "Connection cancelled.");
      throw new RealtimeConnectError("peer_failed", (error as Error)?.message ?? "WebRTC setup failed.");
    }
  }

  /** Send a client event; queued until the data channel is open. */
  send(event: RealtimeClientEvent): void {
    if (this._state === "closed") return;
    if (this._state === "open" && this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(event));
      return;
    }
    this.queue.push(event);
  }

  close(): void {
    this._state = "closed";
    this.queue = [];
    // A connect() still waiting for the channel must fail now, not after the open timeout.
    this.settlePendingOpen?.(new RealtimeConnectError("aborted", "Connection cancelled."));
    if (this.dc) {
      try {
        this.dc.onclose = null;
        this.dc.onmessage = null;
        this.dc.close();
      } catch {
        /* ignore */
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;
        this.pc.oniceconnectionstatechange = null;
        for (const sender of this.pc.getSenders?.() ?? []) {
          try {
            this.pc.removeTrack(sender);
          } catch {
            /* ignore */
          }
        }
        this.pc.close();
      } catch {
        /* ignore */
      }
      this.pc = null;
    }
  }

  private flushQueue(): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    const pending = this.queue;
    this.queue = [];
    for (const event of pending) this.dc.send(JSON.stringify(event));
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new RealtimeConnectError("aborted", "Connection cancelled.");
  }

  private waitForOpen(dc: RTCDataChannel, pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.settlePendingOpen = null;
        fn();
      };
      this.settlePendingOpen = (error) => finish(() => reject(error));
      const timer = setTimeout(
        () => finish(() => reject(new RealtimeConnectError("timeout", "The voice connection took too long to open."))),
        this.openTimeoutMs,
      );
      const onAbort = () => finish(() => reject(new RealtimeConnectError("aborted", "Connection cancelled.")));
      signal?.addEventListener("abort", onAbort, { once: true });
      dc.onopen = () => finish(resolve);
      dc.onerror = () => finish(() => reject(new RealtimeConnectError("peer_failed", "The voice data channel failed.")));
      const previous = pc.onconnectionstatechange;
      pc.onconnectionstatechange = (ev: Event) => {
        if (typeof previous === "function") previous.call(pc, ev);
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          finish(() => reject(new RealtimeConnectError("peer_failed", "The voice connection failed to establish.")));
        }
      };
      if (dc.readyState === "open") finish(resolve);
    });
  }
}
