import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeConnectError, RealtimeWebRTCClient } from "@/lib/ai/realtime/client";
import type { RealtimeServerEvent } from "@/lib/ai/realtime/events";

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly label: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = "closed";
    this.onclose?.();
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static autoOpen = true;
  tracks: MediaStreamTrack[] = [];
  transceivers: Array<{ kind: string; init?: RTCRtpTransceiverInit }> = [];
  dc: FakeDataChannel | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: ((e: Event) => void) | null = null;
  oniceconnectionstatechange: ((e: Event) => void) | null = null;
  closed = false;
  constructor(public readonly config?: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
    return { track } as unknown as RTCRtpSender;
  }
  addTransceiver(kind: string, init?: RTCRtpTransceiverInit) {
    this.transceivers.push({ kind, init });
  }
  createDataChannel(label: string) {
    this.dc = new FakeDataChannel(label);
    return this.dc as unknown as RTCDataChannel;
  }
  async createOffer() {
    return { type: "offer" as const, sdp: "v=0\r\no=- offer\r\n" };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
    if (FakePeerConnection.autoOpen) queueMicrotask(() => this.dc?.open());
  }
  getSenders() {
    return this.tracks.map((track) => ({ track }));
  }
  removeTrack() {}
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
}

const PC = FakePeerConnection as unknown as typeof RTCPeerConnection;

function fakeMic(): MediaStream {
  const track = { kind: "audio", enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack;
  return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

function okFetch(answer = "v=0\r\no=- answer\r\n") {
  return vi.fn(async () => new Response(answer, { status: 200, headers: { "Content-Type": "application/sdp" } })) as unknown as typeof fetch;
}

afterEach(() => {
  FakePeerConnection.instances = [];
  FakePeerConnection.autoOpen = true;
});

describe("RealtimeWebRTCClient.connect", () => {
  it("follows the documented GA flow: offer SDP posted with bearer + application/sdp, answer applied, channel named oai-events", async () => {
    const fetchImpl = okFetch();
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: fetchImpl });
    const events: RealtimeServerEvent[] = [];
    const remote: MediaStream[] = [];
    const mic = fakeMic();

    await client.connect({
      clientSecret: "ek_test_123",
      callsUrl: "https://api.openai.com/v1/realtime/calls",
      micStream: mic,
      onServerEvent: (e) => events.push(e),
      onRemoteStream: (s) => remote.push(s),
    });

    const pc = FakePeerConnection.instances[0];
    expect(pc.tracks).toHaveLength(1);
    expect(pc.dc?.label).toBe("oai-events");
    expect(pc.localDescription?.type).toBe("offer");
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "v=0\r\no=- answer\r\n" });
    expect(client.state).toBe("open");

    const mockFetch = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(url).not.toContain("model=");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("v=0\r\no=- offer\r\n");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ek_test_123");
    expect(headers["Content-Type"]).toBe("application/sdp");
    expect(Object.keys(headers).some((k) => k.toLowerCase() === "openai-beta")).toBe(false);

    // server -> client events are parsed and delivered
    pc.dc?.receive({ type: "session.created", event_id: "e1", session: {} });
    pc.dc?.receive("not json at all" as unknown as object);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("session.created");

    // remote track -> remote stream callback
    const stream = { id: "remote" } as unknown as MediaStream;
    pc.ontrack?.({ streams: [stream], track: {} } as unknown as RTCTrackEvent);
    expect(remote[0]).toBe(stream);
    expect(client.remoteStream).toBe(stream);
  });

  it("queues client events until the channel opens, then flushes in order", async () => {
    FakePeerConnection.autoOpen = false;
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch(), dataChannelOpenTimeoutMs: 2000 });
    const connecting = client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} });
    client.send({ type: "response.create" });
    client.send({ type: "session.update", session: { type: "realtime", instructions: "hi" } });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.remoteDescription).toBeTruthy());
    const pc = FakePeerConnection.instances[0];
    expect(pc.dc?.sent).toEqual([]);
    pc.dc?.open();
    await connecting;
    expect(pc.dc?.sent.map((s) => JSON.parse(s).type)).toEqual(["response.create", "session.update"]);
    client.send({ type: "response.cancel" });
    expect(pc.dc?.sent).toHaveLength(3);
    client.close();
    expect(client.state).toBe("closed");
    expect(pc.closed).toBe(true);
    client.send({ type: "response.cancel" }); // ignored after close
    expect(pc.dc?.sent).toHaveLength(3);
  });

  it("negotiates a receive-only audio line when there is no microphone", async () => {
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch() });
    await client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: null, onServerEvent: () => {} });
    const pc = FakePeerConnection.instances[0];
    expect(pc.tracks).toHaveLength(0);
    expect(pc.transceivers).toEqual([{ kind: "audio", init: { direction: "recvonly" } }]);
  });

  it("rejects with sdp_rejected when the calls endpoint refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad token", { status: 401 })) as unknown as typeof fetch;
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: fetchImpl });
    await expect(client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} })).rejects.toMatchObject({
      name: "RealtimeConnectError",
      code: "sdp_rejected",
      status: 401,
    });
    expect(FakePeerConnection.instances[0].closed).toBe(true);
    expect(client.state).toBe("closed");
  });

  it("rejects with network when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: fetchImpl });
    await expect(client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} })).rejects.toMatchObject({ code: "network" });
  });

  it("times out when the data channel never opens", async () => {
    FakePeerConnection.autoOpen = false;
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch(), dataChannelOpenTimeoutMs: 30 });
    await expect(client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} })).rejects.toMatchObject({ code: "timeout" });
    expect(client.state).toBe("closed");
  });

  it("honours an abort signal", async () => {
    FakePeerConnection.autoOpen = false;
    const controller = new AbortController();
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch(), dataChannelOpenTimeoutMs: 5000 });
    const pending = client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {}, signal: controller.signal });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.remoteDescription).toBeTruthy());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(client.state).toBe("closed");

    const already = new AbortController();
    already.abort();
    const client2 = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch() });
    await expect(client2.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: null, onServerEvent: () => {}, signal: already.signal })).rejects.toBeInstanceOf(RealtimeConnectError);
  });

  it("reports peer connection and ICE state changes and unexpected channel close", async () => {
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch() });
    const states: string[] = [];
    const ice: string[] = [];
    let closed = 0;
    await client.connect({
      clientSecret: "ek",
      callsUrl: "https://x/calls",
      micStream: fakeMic(),
      onServerEvent: () => {},
      onConnectionState: (s) => states.push(s),
      onIceConnectionState: (s) => ice.push(s),
      onDataChannelClose: () => closed++,
    });
    const pc = FakePeerConnection.instances[0];
    pc.connectionState = "connected";
    pc.onconnectionstatechange?.(new Event("x"));
    pc.iceConnectionState = "disconnected";
    pc.oniceconnectionstatechange?.(new Event("x"));
    expect(states).toEqual(["connected"]);
    expect(ice).toEqual(["disconnected"]);
    pc.dc?.close();
    expect(closed).toBe(1);
    expect(client.state).toBe("closed");
  });

  it("fails fast when WebRTC is unavailable", async () => {
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: undefined as unknown as typeof RTCPeerConnection, fetch: okFetch() });
    // In Node there is no global RTCPeerConnection, so the constructor falls back to undefined.
    await expect(client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: null, onServerEvent: () => {} })).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("RealtimeWebRTCClient.close during connect", () => {
  it("rejects a pending connect() immediately with 'aborted' instead of waiting for the open timeout", async () => {
    FakePeerConnection.autoOpen = false;
    const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: okFetch(), dataChannelOpenTimeoutMs: 15_000 });
    const pending = client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} });
    await vi.waitFor(() => expect(FakePeerConnection.instances[0]?.remoteDescription).toBeTruthy());
    const started = Date.now();
    client.close(); // e.g. the adapter tears the transport down while a reconnect attempt is still negotiating
    await expect(pending).rejects.toMatchObject({ name: "RealtimeConnectError", code: "aborted" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(client.state).toBe("closed");
    expect(FakePeerConnection.instances[0].closed).toBe(true);
  });

  it("leaves no unhandled rejection behind when connect() fails before the channel opens", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const fetchImpl = vi.fn(async () => new Response("bad token", { status: 401 })) as unknown as typeof fetch;
      const client = new RealtimeWebRTCClient({ RTCPeerConnection: PC, fetch: fetchImpl, dataChannelOpenTimeoutMs: 50 });
      await expect(client.connect({ clientSecret: "ek", callsUrl: "https://x/calls", micStream: fakeMic(), onServerEvent: () => {} })).rejects.toMatchObject({ code: "sdp_rejected" });
      // Previously the internal waitForOpen() promise kept ticking and rejected with "timeout" here, unobserved.
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      vi.useRealTimers();
    }
  });
});
