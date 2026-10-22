# OpenAI Realtime API (WebRTC) — Verification of Current Facts

**Fetched live on 2026-10-22** from official OpenAI documentation. Note: `platform.openai.com/docs/*` now redirects to `developers.openai.com/api/docs/*` (the official docs host); all URLs below are the resolved URLs. Every fact carries a source URL and a verbatim quote. Items that could not be confirmed are listed at the end.

> **Headline changes vs. the assumptions in the task brief**
> - `gpt-realtime` (snapshot `gpt-realtime-2025-08-28`) and `gpt-realtime-mini` are **deprecated** (shutdown **Jan 20, 2027**). Current recommended models are **`gpt-realtime-2.1`** (full) and **`gpt-realtime-2.1-mini`** (low-cost). Both are reasoning models with a 128k context window.
> - `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` are **deprecated** (shutdown Feb 26, 2027); replacements are `gpt-live-transcribe` / `gpt-transcribe`. `gpt-realtime-whisper` is also available for Realtime input transcription.
> - OpenAI now also offers a separate **GPT-Live** API (`gpt-live-1`, `POST /v1/live/sessions`, $0.05/min, full-duplex, delegates reasoning + web search to a Responses backend) and the audio overview recommends it for *new* conversational voice apps. The Realtime API remains fully documented and supported; this file covers Realtime as requested, with GPT-Live noted where relevant.
> - Pricing for text output on the 2.x realtime models is **$24/1M** (not $16). Audio prices are unchanged ($32 in / $64 out).

---

## 1. Realtime model IDs

### Catalog entries (Realtime family)
Source: https://developers.openai.com/api/docs/models
> "GPT-Realtime: Model capable of realtime text and audio inputs and outputs · GPT-Realtime Mini: A cost-efficient version of GPT-Realtime · GPT-Realtime-1.5: The best voice model for audio in, audio out · GPT-Realtime-2: Reasoning model with tool use · GPT-Realtime-2.1: Reasoning model with tool use · GPT-Realtime-2.1 Mini: Reasoning model with tool use · GPT-Realtime-Translate · GPT-Realtime-Whisper · GPT-Transcribe · GPT-Live 1 · GPT-Live-Transcribe"

### Full-quality model: `gpt-realtime-2.1` (current recommended)
Source: https://developers.openai.com/api/docs/models/gpt-realtime-2.1
> "Model ID: `gpt-realtime-2.1` … GPT-Realtime-2.1 updates GPT-Realtime-2 with improved alphanumeric recognition, silence and noise handling, and interruption behavior. It supports speech-to-speech interactions with configurable reasoning effort, instruction following, and tool use"
> "Default snapshot: `gpt-realtime-2.1` · Input modalities: text, audio, image · Output modalities: text, audio · 128,000 context window · 32,000 max output tokens · Sep 30, 2024 knowledge cutoff · Reasoning token support"
> Snapshots: "- `gpt-realtime-2.1`" (no dated snapshot listed)

Released Jul 6, 2026 — Source: https://developers.openai.com/api/docs/changelog
> "Released GPT-Realtime-2.1, an updated realtime reasoning model … Also released GPT-Realtime-2.1 mini, a faster, lower-cost distilled reasoning model for realtime voice applications."

The WebRTC guide, conversations guide, and tools guide all use `model: "gpt-realtime-2.1"` in their examples (https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime).

### Lower-cost model: `gpt-realtime-2.1-mini` (current recommended)
Source: https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini
> "Model ID: `gpt-realtime-2.1-mini` … GPT-Realtime-2.1 Mini is a distilled reasoning model for faster, lower-cost realtime voice interactions. It supports audio and text inputs over WebRTC, WebSocket, or SIP connections"
> "128,000 context window · 32,000 max output tokens · Reasoning token support" · Snapshots: "- `gpt-realtime-2.1-mini`"

### Other current/legacy realtime models
- `gpt-realtime-2` — https://developers.openai.com/api/docs/models/gpt-realtime-2 — "128,000 context window · 32,000 max output tokens"; released May 7, 2026 (changelog).
- `gpt-realtime-1.5` — https://developers.openai.com/api/docs/models/gpt-realtime-1.5 — "The best voice model for audio in, audio out … 32,000 context window · 4,096 max output tokens" (non-reasoning). Released Feb 23, 2026 (changelog).
- `gpt-realtime` — https://developers.openai.com/api/docs/models/gpt-realtime — page badge reads **"Deprecated"**; "32,000 context window · 4,096 max output tokens"; snapshot `gpt-realtime-2025-08-28`.
- `gpt-realtime-mini` — https://developers.openai.com/api/docs/models/gpt-realtime-mini — "Default snapshot: `gpt-realtime-mini-2025-12-15`"; snapshots `gpt-realtime-mini-2025-10-06`, `gpt-realtime-mini-2025-12-15`; "32,000 context window · 4,096 max output tokens".

Deprecation schedule — Source: https://developers.openai.com/api/docs/deprecations
> "2026-07-20: Legacy audio, realtime, and transcription models … Jan 20, 2027 | `gpt-realtime` | `gpt-realtime-2.1` … Jan 20, 2027 | `gpt-realtime-mini` | `gpt-realtime-2.1-mini`"
> "July 23, 2026 | `gpt-realtime-mini-2025-10-06` | `gpt-realtime-2.1-mini`" (already shut down)

### Accepted `session.model` values (GA session schema)
Source: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
> "`model`: … `"gpt-realtime"`, `"gpt-realtime-1.5"`, `"gpt-realtime-2"`, `"gpt-realtime-2.1"`, `"gpt-realtime-2.1-mini"`, `"gpt-realtime-2025-08-28"`, `"gpt-4o-realtime-preview"`, … `"gpt-realtime-mini"`, `"gpt-realtime-mini-2025-10-06"`, `"gpt-realtime-mini-2025-12-15"`, `"gpt-audio-1.5"`, `"gpt-audio-mini"`, …"

### Input-audio transcription models usable in Realtime sessions
Source: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create (`session.audio.input.transcription.model`)
> "The model to use for transcription. Current options are `whisper-1`, `gpt-transcribe`, `gpt-live-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, and `gpt-realtime-whisper`."
> "`delay` … Only supported with `gpt-realtime-whisper` in GA Realtime sessions." · "Prompt is not supported with `gpt-realtime-whisper` in GA Realtime sessions."
> "`keywords` … Supported by `gpt-transcribe` and `gpt-live-transcribe`." · "`languages` … Supported by `gpt-transcribe` and `gpt-live-transcribe`."

Deprecation caveat — Source: https://developers.openai.com/api/docs/deprecations
> "Feb 26, 2027 | `whisper-1` | `gpt-live-transcribe` or `gpt-transcribe` … `gpt-4o-transcribe` … `gpt-4o-mini-transcribe` … `gpt-4o-transcribe-diarize`"

Cost guide recommendation for committed-turn input transcription — Source: https://developers.openai.com/api/docs/guides/voice-latency-cost?api=realtime
> "Use `gpt-transcribe` for committed-turn transcription, which begins after audio is written to the input audio buffer and the buffer is committed."

Pricing per model: see Section 7.

### Supported output voices
Source: https://developers.openai.com/api/docs/guides/realtime-conversations
> "Current voice options are `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`. Once the model has emitted audio in a session, the `voice` cannot be modified for that session. For best quality, we recommend using `marin` or `cedar`."

Source: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
> "Supported built-in voices are `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`. You may also provide a custom voice object with an `id`, for example `{ "id": "voice_1234" }`. … Custom voices must be created from audio samples. Voices created from text prompts are supported only in Live."

**Gender labels:** The docs do **not** label any Realtime voice as male- or female-leaning. No gender descriptors appear in the conversations guide, the session schema, or the voice prompting guide.

---

## 2. WebRTC connection flow

Two documented mechanisms — Source: https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime
> "The Realtime API supports two mechanisms for connecting from the browser: the unified interface and ephemeral API keys … Use the unified interface for simpler setup and faster connections. This approach puts your application server in the critical path for session initialization."

### (A) Server-side: mint an ephemeral client secret
Endpoint — Source: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
> "**post** `/realtime/client_secrets` — Create a Realtime client secret with an associated session configuration. Client secrets are short-lived tokens that can be passed to a client app … You can configure a custom TTL for each client secret."
> "Returns the created client secret and the effective session object. The client secret is a string that looks like `ek_1234`."

Request body shape:
> "`expires_after: optional object { anchor, seconds }` … `anchor: optional "created_at"` … Only `created_at` is currently supported. … `seconds: optional number` — The number of seconds from the anchor point to the expiration. Select a value between `10` and `7200` (2 hours). This default to 600 seconds (10 minutes) if not specified."
> "`session: optional RealtimeSessionCreateRequest or RealtimeTranscriptionSessionCreateRequest` — Session configuration to use for the client secret."
> "Expiration refers to the time after which a client secret will no longer be valid for creating sessions. The session itself may continue after that time once started. A secret can be used to create multiple sessions until it expires."

Documented example (verbatim from the reference):
```
curl -X POST https://api.openai.com/v1/realtime/client_secrets \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "expires_after": { "anchor": "created_at", "seconds": 600 },
    "session": { "type": "realtime", "model": "gpt-realtime", "instructions": "You are a friendly assistant." }
  }'
```
Response: `{"value": "ek_68af296e8e408191a1120ab6383263c2", "expires_at": 1756310470, "session": {...}}`. Returns: "`expires_at: number` — Expiration timestamp for the client secret, in seconds since epoch."

WebRTC guide server example uses `model: "gpt-realtime-2.1"`, `audio: { output: { voice: "marin" } }`, and adds an optional header:
> "When using ephemeral tokens, set `OpenAI-Safety-Identifier` on the server-side request that creates the client secret. The Realtime API binds the identifier to the resulting ephemeral token, so the browser does not need to send the safety identifier when it later connects with that token."

### (B) Browser-side: exchange SDP with the ephemeral key
Source: https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime (verbatim code)
```js
const EPHEMERAL_KEY = data.value;
const pc = new RTCPeerConnection();
pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);
const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
pc.addTrack(ms.getTracks()[0]);
const dc = pc.createDataChannel("oai-events");
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
  method: "POST",
  body: offer.sdp,
  headers: { Authorization: `Bearer ${EPHEMERAL_KEY}`, "Content-Type": "application/sdp" },
});
const answer = { type: "answer", sdp: await sdpResponse.text() };
await pc.setRemoteDescription(answer);
```
Data channel name confirmed: `pc.createDataChannel("oai-events")`.

Calls endpoint reference — Source: https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create
> "**post** `/realtime/calls` — Create a new Realtime API call over WebRTC and receive the SDP answer needed to complete the peer connection."
> Example (unified/server-key form): `curl -X POST https://api.openai.com/v1/realtime/calls -H "Authorization: Bearer $OPENAI_API_KEY" -F "sdp=<offer.sdp;type=application/sdp" -F 'session={"type":"realtime","model":"gpt-realtime"};type=application/json'`
> Response body is a raw SDP answer (`v=0 … m=audio 9 UDP/TLS/RTP/SAVPF 111 0 8 … a=rtpmap:111 opus/48000/2 … m=application 9 UDP/DTLS/SCTP webrtc-datachannel`).

### (C) Unified interface (alternative: server posts SDP + session as multipart)
Source: https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime
> "The server combines that SDP with its session configuration in a multipart form and sends that to the OpenAI Realtime API, authenticating it with its standard API key."
> Code: `fd.set("sdp", req.body); fd.set("session", sessionConfig); fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: \`Bearer ${process.env.OPENAI_API_KEY}\`, "OpenAI-Safety-Identifier": "hashed-user-id" }, body: fd })` where `sessionConfig = JSON.stringify({ type: "realtime", model: "gpt-realtime-2.1", audio: { output: { voice: "marin" } } })`.

### Where the model is specified
- **Ephemeral flow:** in the `session.model` field of the `POST /v1/realtime/client_secrets` body (the browser's `POST /v1/realtime/calls` carries only the SDP + bearer token). The WebRTC guide's browser example does **not** append any `?model=` query parameter to `/v1/realtime/calls`.
- **Unified flow:** in the multipart `session` JSON field posted to `/v1/realtime/calls`.
- A `?model=` query parameter is documented only for the **WebSocket** URL: `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1` (https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime).

### GA migration notes
Source: https://developers.openai.com/api/docs/guides/realtime
> "Remove the `OpenAI-Beta: realtime=v1` header when calling the GA interface. Use `POST /v1/realtime/client_secrets` to create ephemeral credentials for browser or mobile clients. Use `/v1/realtime/calls` when establishing WebRTC sessions. … set `session.type`, move output audio configuration under `session.audio.output`, and use the newer response event names like `response.output_text.delta`, `response.output_audio.delta`, and `response.output_audio_transcript.delta`."
> "The Realtime API Beta was deprecated and removed from the API on May 12, 2026." (https://developers.openai.com/api/docs/deprecations)

---

## 3. Session configuration schema (GA, `type: "realtime"`)

All quotes from https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create (the same `RealtimeSessionCreateRequest` object is used by `session.update`, https://developers.openai.com/api/reference/resources/realtime/client-events) unless otherwise noted.

### `session.update` semantics
> "The client may send this event at any time to update any field except for `voice` and `model`. `voice` can be updated only if there have been no other audio outputs yet. When the server receives a `session.update`, it will respond with a `session.updated` event showing the full, effective configuration. Only the fields that are present in the `session.update` are updated. To clear a field like `instructions`, pass an empty string. To clear a field like `tools`, pass an empty array. To clear a field like `turn_detection`, pass `null`."

Documented full example (https://developers.openai.com/api/docs/guides/realtime-conversations):
```json
{ "type": "session.update",
  "session": {
    "type": "realtime",
    "model": "gpt-realtime-2.1",
    "output_modalities": ["audio"],
    "audio": {
      "input":  { "format": { "type": "audio/pcm", "rate": 24000 }, "turn_detection": { "type": "semantic_vad" } },
      "output": { "format": { "type": "audio/pcm", "rate": 24000 }, "voice": "marin" }
    },
    "instructions": "Speak clearly and briefly. Confirm understanding before taking actions."
  } }
```
(WebRTC note from the GPT-Live page of the same guide family: audio format is negotiated via SDP; for Realtime over WebRTC you likewise do not need to send audio buffer events — see Section 5.)

### `instructions`
> "The default system instructions (i.e. system message) prepended to model calls. … The instructions are not guaranteed to be followed by the model … Note that the server sets default instructions which will be used if this field is not set and are visible in the `session.created` event at the start of the session."

### `audio.output.voice` / `audio.output.speed`
> "`voice`: … Supported built-in voices are `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`. … Voice cannot be changed during the session once the model has responded with audio at least once."
> "`speed`: The speed of the model's spoken response as a multiple of the original speed. 1.0 is the default speed. 0.25 is the minimum speed. 1.5 is the maximum speed. This value can only be changed in between model turns"

### `audio.input.turn_detection`
> "Configuration for turn detection, ether Server VAD or Semantic VAD. This can be set to `null` to turn off, in which case the client must manually trigger model response."

**`server_vad`** (fields: `type`, `threshold`, `prefix_padding_ms`, `silence_duration_ms`, `idle_timeout_ms`, `create_response`, `interrupt_response`):
> "`threshold`: Activation threshold for VAD (0.0 to 1.0), this defaults to 0.5."
> "`prefix_padding_ms`: Amount of audio to include before the VAD detected speech (in milliseconds). Defaults to 300ms."
> "`silence_duration_ms`: Duration of silence to detect speech stop (in milliseconds). Defaults to 500ms."
> "`idle_timeout_ms: optional number or null` — Optional timeout after which a model response will be triggered automatically. … The timeout value will be applied after the last model response's audio has finished playing … An `input_audio_buffer.timeout_triggered` event … will be emitted when the timeout is reached. Idle timeout is currently only supported for `server_vad` mode."
> "`create_response`: Whether or not to automatically generate a response when a VAD stop event occurs. … If both `create_response` and `interrupt_response` are set to `false`, the model will never respond automatically but VAD events will still be emitted."
> "`interrupt_response`: Whether or not to automatically interrupt (cancel) any ongoing response with output to the default conversation (i.e. `conversation` of `auto`) when a VAD start event occurs. If `true` then the response will be cancelled, otherwise it will continue until complete."

VAD guide example (https://developers.openai.com/api/docs/guides/realtime-vad):
```json
{ "type": "session.update", "session": { "type": "realtime", "audio": { "input": { "turn_detection": {
  "type": "server_vad", "threshold": 0.5, "prefix_padding_ms": 300, "silence_duration_ms": 500,
  "create_response": true, "interrupt_response": true } } } } }
```

**`semantic_vad`** (fields: `type`, `eagerness`, `create_response`, `interrupt_response`):
> "`eagerness: optional "low" or "medium" or "high" or "auto"` — The eagerness of the model to respond. `low` will wait longer for the user to continue speaking, `high` will respond more quickly. `auto` is the default and is equivalent to `medium`. `low`, `medium`, and `high` have max timeouts of 8s, 4s, and 2s respectively."
> VAD guide: "Semantic VAD … uses a semantic classifier to detect when the user has finished speaking, based on the words they have uttered. … With this mode, the model is less likely to interrupt the user during a speech-to-speech conversation"
> Default mode: "For sessions and models that support VAD, the default value is `server_vad`."

### `audio.input.transcription`
> "Configuration for input audio transcription, defaults to off and can be set to `null` to turn off once on. Input audio transcription is not native to the model, since the model consumes audio directly. Transcription runs asynchronously … and should be treated as guidance of input audio content rather than precisely what the model heard."
Fields: `model` (enum in Section 1), `language` ("ISO-639-1 (e.g. `en`) format"), `languages` (array; gpt-transcribe / gpt-live-transcribe), `prompt` (free text for gpt-4o-transcribe models; keyword list for whisper-1; "not supported with `gpt-realtime-whisper`"), `keywords`, `delay` (`minimal|low|medium|high|xhigh`, gpt-realtime-whisper only).

### `audio.input.noise_reduction`
> "Configuration for input audio noise reduction. This can be set to `null` to turn off. Noise reduction filters audio added to the input audio buffer before it is sent to VAD and the model. … `type`: `near_field` is for close-talking microphones such as headphones, `far_field` is for far-field microphones such as laptop or conference room microphones."
> Client events ref: `{"type":"session.update","session":{"type":"realtime","audio":{"input":{"noise_reduction":null}}}}` turns it off; "Omitting `audio.input.noise_reduction` from an update leaves its current setting unchanged."

### `tools` — function tool shape
> "`RealtimeFunctionTool object { description, name, parameters, type }` … `parameters: optional unknown` — Parameters of the function in JSON Schema. `type: optional "function"` — The type of the tool, i.e. `function`."
Confirmed: the JSON Schema is at the **top level** of the tool object (no nested `function` wrapper) and `type: "function"` is a sibling key. Documented example (https://developers.openai.com/api/docs/guides/realtime-mcp):
```json
{ "type": "function", "name": "lookup_order", "description": "Look up an order by its order number.",
  "parameters": { "type": "object", "properties": { "order_number": { "type": "string", "description": "The customer-facing order number." } }, "required": ["order_number"] } }
```
> "Add tools in one of two places: At the session level with `session.tools` in `session.update` … At the response level with `response.tools` in `response.create`"
> "`parallel_tool_calls: optional boolean` — Whether the model may call multiple tools in parallel. Only supported by reasoning Realtime models such as `gpt-realtime-2`."

### `tool_choice`
> "`ToolChoiceOptions = "none" or "auto" or "required"` … `ToolChoiceFunction object { name, type }` — Use this option to force the model to call a specific function. … `ToolChoiceMcp object { server_label, type, name }`"

### `output_modalities`
> "The set of modalities the model can respond with. It defaults to `["audio"]`, indicating that the model will respond with audio plus a transcript. `["text"]` can be used to make the model respond with text only. It is not possible to request both `text` and `audio` at the same time."

### `max_output_tokens`
> "Maximum number of output tokens for a single assistant response, inclusive of tool calls. Provide an integer between 1 and 4096 to limit output tokens, or `inf` for the maximum available tokens for a given model. Defaults to `inf`."

### `reasoning.effort` (2.x models)
> "Constrains effort on reasoning for reasoning-capable Realtime models such as `gpt-realtime-2`. `"minimal"` `"low"` `"medium"` `"high"` `"xhigh"`"
> Prompting guide (https://developers.openai.com/api/docs/guides/voice-prompting): "Start with `low` for most production voice agents."

### `truncation`
> "`"auto" or "disabled"` — `auto` is the default truncation strategy. `disabled` will disable truncation and emit errors when the conversation exceeds the input token limit. … `RetentionRatioTruncation object { retention_ratio, type, token_limits }` … `token_limits.post_instructions` — Maximum tokens allowed in the conversation after instructions"

### MCP servers in Realtime: **YES**
Source: https://developers.openai.com/api/docs/guides/realtime-mcp
> "Use MCP tools when the Realtime API should connect to a remote tool server for you. … In Realtime, the MCP tool shape is: `type: "mcp"`, `server_label`, One of `server_url` or `connector_id`, Optional `authorization` and `headers`, Optional `allowed_tools`, Optional `require_approval`, Optional `server_description`"
> "Unlike Realtime `function` tools, remote MCP tools are executed by the Realtime API itself."
> "`connector_id` is deprecated for models released after September 1, 2026. Use `server_url` to connect to a remote MCP server"
> "`response.done` for a response can arrive before its MCP calls finish. After the response is done and all of its MCP calls have finished, send another `response.create` event … The Realtime API doesn't create these follow-up responses automatically."

### Built-in web search tool in Realtime: **NO (confirmed)**
The Realtime tool union in the session schema and `response.create` schema contains only `RealtimeFunctionTool` (`type: "function"`) and `McpTool` (`type: "mcp"`). The string `web_search` appears **zero** times in the client-secrets reference, the client-events reference, or the server-events reference (checked 2026-10-22). Web search is available only via the Responses API (Section 8) — e.g., called from your own function tool handler — or, alternatively, via GPT-Live's Responses delegation (`delegation.responses.tools: [{ type: "web_search" }]`, https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=live).

---

## 4. Interruption / barge-in

### Automatic behavior with VAD (and WebRTC-specific truncation)
Source: https://developers.openai.com/api/docs/guides/realtime-conversations
> "Realtime API handles interruptions when VAD is enabled, in that it detects user speech, cancels the ongoing response, and starts a new one. … We call this **truncating** the model's last response, that is, removing the unplayed portion of the model's last response from the conversation."
> "**In WebRTC and SIP connections the server manages a buffer of output audio, and thus knows how much audio has been played at a given moment. The server will automatically truncate unplayed audio when there's a user interruption.**"
> "With a WebSocket connection the client manages audio playback, and thus must stop playback and handle truncation. … The client monitors for new `input_audio_buffer.speech_started` events … The server will automatically cancel any in-progress model response and a `response.cancelled` event will be emitted. … The client should send a `conversation.item.truncate` event"

(Note: the server-events reference does not list a standalone `response.cancelled` event; cancellation surfaces as `response.done` with `response.status: "cancelled"` and `status_details.reason: "turn_detected"` — see below.)

`interrupt_response` controls this: "Whether or not to automatically interrupt (cancel) any ongoing response … when a VAD start event occurs. If `true` then the response will be cancelled, otherwise it will continue until complete." (client_secrets ref)

### Server events signalling user speech
Source: https://developers.openai.com/api/reference/resources/realtime/server-events
> "`input_audio_buffer.speech_started` — Sent by the server when in `server_vad` mode to indicate that speech has been detected in the audio buffer. … The client may want to use this event to interrupt audio playback or provide visual feedback to the user." Example: `{"type":"input_audio_buffer.speech_started","audio_start_ms":1000,"item_id":"msg_003"}`
> "`input_audio_buffer.speech_stopped` — Returned in `server_vad` mode when the server detects the end of speech in the audio buffer. The server will also send an `conversation.item.created` event with the user message item" Example: `{"type":"input_audio_buffer.speech_stopped","audio_end_ms":2000,"item_id":"msg_003"}`
> "`output_audio_buffer.cleared` — **WebRTC/SIP Only:** Emitted when the output audio buffer is cleared. This happens either in VAD mode when the user has interrupted (`input_audio_buffer.speech_started`), or when the client has emitted the `output_audio_buffer.clear` event"

Cancelled response status — same source:
> "`status_details.reason`: … For a `cancelled` Response, one of `turn_detected` (the server VAD detected a new start of speech) or `client_cancelled` (the client sent a cancel event)."

### Client events for manual interruption
Source: https://developers.openai.com/api/reference/resources/realtime/client-events
> "`response.cancel` — Send this event to cancel an in-progress response. The server will respond with a `response.done` event with a status of `response.status=cancelled`. … It's safe to call `response.cancel` even if no response is in progress" Schema: `{ "type": "response.cancel", "response_id": "resp_12345" }` (`response_id` optional).
> "`output_audio_buffer.clear` — **WebRTC/SIP Only:** Emit to cut off the current audio response. This will trigger the server to stop generating audio and emit a `output_audio_buffer.cleared` event. This event should be preceded by a `response.cancel` client event"
> "`conversation.item.truncate` — Send this event to truncate a previous assistant message's audio. … Truncating audio will delete the server-side text transcript to ensure there is not text in the context that hasn't been heard by the user. If successful, the server will respond with a `conversation.item.truncated` event." Schema: `{ "type": "conversation.item.truncate", "item_id": "item_002", "content_index": 0, "audio_end_ms": 1500 }`

WebRTC push-to-talk recipe (conversations guide): "On push down, send an `input_audio_buffer.clear` event … If there is an in-progress response from the model, cancel it by sending a `response.cancel` event. If there is ongoing output playback from the model, send an `output_audio_buffer.clear` event to clear out the unplayed audio, this truncates the conversation as well."

---

## 5. Server events for transcripts, tools, and usage

Source for all event names/quotes: https://developers.openai.com/api/reference/resources/realtime/server-events (confirmed headings list).

| Purpose | Event | Verbatim note |
|---|---|---|
| Session ready | `session.created` | "Emitted automatically when a new connection is established as the first server event. This event will contain the default Session configuration." |
| Config applied | `session.updated` | "Returned when a session is updated with a `session.update` event, unless there is an error." |
| Assistant transcript (streaming) | `response.output_audio_transcript.delta` | "Returned when the model-generated transcription of audio output is updated." Fields: `response_id, item_id, output_index, content_index, delta` |
| Assistant transcript (final) | `response.output_audio_transcript.done` | "Also emitted when a Response is interrupted, incomplete, or cancelled." Field: `transcript` |
| Text-only output | `response.output_text.delta` / `.done` | listed |
| User transcript (streaming) | `conversation.item.input_audio_transcription.delta` | "Returned when the text value of an input audio transcription content part is updated with incremental transcription results." Example fields: `item_id, content_index, delta` |
| User transcript (final) | `conversation.item.input_audio_transcription.completed` | "Transcription begins when the input audio buffer is committed by the client or server (when VAD is enabled). Transcription runs asynchronously with Response creation, so this event may come before or after the Response events." Fields: `item_id, content_index, transcript, usage` |
| User transcript failed | `conversation.item.input_audio_transcription.failed` | "These events are separate from other `error` events so that the client can identify the related Item." Example `error.code: "audio_unintelligible"` |
| Function args (stream) | `response.function_call_arguments.delta` | fields `response_id, item_id, output_index, call_id, delta` |
| Function args (final) | `response.function_call_arguments.done` | fields `… call_id, name, arguments` (JSON string) |
| Item finished | `response.output_item.done` | "Returned when an Item is done streaming. Also emitted when a Response is interrupted, incomplete, or cancelled." `item.type` may be `function_call` (with `name`, `call_id`, `arguments`) or `message` |
| Response finished | `response.done` | "Always emitted, no matter the final state. … Clients should check the `status` field … `completed` … `cancelled`, `failed`, or `incomplete`." |
| Rate limits | `rate_limits.updated` | "Emitted at the beginning of a Response to indicate the updated rate limits." Example entries `{name:"requests", limit, remaining, reset_seconds}`, `{name:"tokens", …}` |
| Errors | `error` | "Most errors are recoverable and the session will stay open" — payload `error: {type, code, message, param, event_id}` |
| WebRTC audio buffer | `output_audio_buffer.started` / `.stopped` / `.cleared` | all "**WebRTC/SIP Only**"; `.started` "emitted after an audio content part has been added (`response.content_part.added`)"; `.stopped` "emitted after the full response data has been sent to the client (`response.done`)" |
| Idle timeout | `input_audio_buffer.timeout_triggered` | "configured with `idle_timeout_ms` … there hasn't been any speech detected for the configured duration" |
| MCP lifecycle | `mcp_list_tools.in_progress/.completed/.failed`, `response.mcp_call_arguments.delta/.done`, `response.mcp_call.in_progress/.completed/.failed` | listed |

### Function-call round trip (client side)
Source: https://developers.openai.com/api/docs/guides/realtime-conversations and https://developers.openai.com/api/reference/resources/realtime/client-events
> `response.done` example output item: `{"type": "function_call", "status": "completed", "name": "generate_horoscope", "call_id": "call_sHlR7iaFwQ2YQOqm", "arguments": "{\"sign\":\"Aquarius\"}"}` — "`response.output[0].call_id` — A system-generated ID for this function call - **you will need this ID to pass a function call result back to the model**."
> Send result: `{"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": "call_sHlR7iaFwQ2YQOqm", "output": "{\"horoscope\": \"You will soon meet a new friend.\"}"}}` then `{"type": "response.create"}` — "This will trigger a model response using the data from the function call."
> `conversation.item.create`: "If successful, the server will emit a `conversation.item.added` event and, when the item is finalized, a `conversation.item.done` event."

### `response.done.response.usage` fields (verbatim example)
Source: https://developers.openai.com/api/reference/resources/realtime/server-events
```json
"usage": {
  "total_tokens": 253, "input_tokens": 132, "output_tokens": 121,
  "input_token_details": { "text_tokens": 119, "audio_tokens": 13, "image_tokens": 0, "cached_tokens": 64,
    "cached_tokens_details": { "text_tokens": 64, "audio_tokens": 0, "image_tokens": 0 } },
  "output_token_details": { "text_tokens": 30, "audio_tokens": 91 } }
```
Input-transcription usage arrives on `conversation.item.input_audio_transcription.completed`: token-billed models return `"usage": {"type": "tokens", "total_tokens", "input_tokens", "input_token_details": {"text_tokens","audio_tokens"}, "output_tokens"}`; duration-billed models (e.g. `gpt-transcribe`) return `"usage": {"type": "duration", "seconds": 3}` (https://developers.openai.com/api/docs/guides/voice-latency-cost?api=realtime).

---

## 6. Limits

### Session duration: 60 minutes
Source: https://developers.openai.com/api/docs/guides/realtime-conversations
> "Most session properties can be updated at any time, except for the `voice` the model uses for audio output, after the model has responded with audio once during the session. The maximum duration of a Realtime session is **60 minutes**."

### Ephemeral key expiry
Source: https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
> "Select a value between `10` and `7200` (2 hours). This default to 600 seconds (10 minutes) if not specified." … "The session itself may continue after that time once started. A secret can be used to create multiple sessions until it expires."

### Context window / truncation
- `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2`: "128,000 context window · 32,000 max output tokens" (model pages).
- `gpt-realtime-1.5`, `gpt-realtime`, `gpt-realtime-mini`: "32,000 context window · 4,096 max output tokens" (model pages).

Source: https://developers.openai.com/api/docs/guides/voice-latency-cost?api=realtime
> "When the number of tokens in a conversation exceeds the model's input token limit the conversation be truncated, meaning messages (starting from the oldest) will be dropped from the Response input. A 32k context model with 4,096 max output tokens can only include 28,224 tokens in the context before truncation occurs."
> "The server defaults to a value of `1.0`, meaning truncation will remove only the items necessary. A value of `0.8` means a truncation would retain 80% of the maximum, dropping an additional 20%."
> Example: `"truncation": { "type": "retention_ratio", "retention_ratio": 0.8, "token_limits": { "post_instructions": 8000 } }`; `"truncation": "disabled"` → "an error will be returned if the Conversation is too long to create a Response."
> "Audio tokens in user messages are 1 token per 100 ms of audio, while audio tokens in assistant messages are 1 token per 50ms of audio."

### Rate limits (gpt-realtime-2.1, default)
Source: https://developers.openai.com/api/docs/models/gpt-realtime-2.1 — "Build 400 RPM / 200,000 TPM · Launch 10,000 / 4,000,000 · Grow 20,000 / 15,000,000"

---

## 7. Pricing (fetched 2026-10-22)

Primary source: https://developers.openai.com/api/docs/pricing ("Realtime and audio generation models — Prices per 1M tokens unless noted"). Cross-checked against https://openai.com/api/pricing/ (which now resolves to https://openai.com/business/pricing/#api) and the individual model pages. All three agree on the numbers below.

| Model | Text in | Text cached | Text out | Audio in | Audio cached | Audio out | Image in |
|---|---|---|---|---|---|---|---|
| `gpt-realtime-2.1` | $4.00 | $0.40 | **$24.00** | $32.00 | $0.40 | $64.00 | $5.00 |
| `gpt-realtime-2.1-mini` | $0.60 | $0.06 | $2.40 | $10.00 | $0.30 | $20.00 | $0.80 |
| `gpt-realtime-2` | $4.00 | $0.40 | $24.00 | $32.00 | $0.40 | $64.00 | $5.00 |
| `gpt-realtime-1.5` | $4.00 | $0.40 | $16.00 | $32.00 | $0.40 | $64.00 | $5.00 |
| `gpt-realtime` (deprecated) | $4.00 | $0.40 | $16.00 | $32.00 | $0.40 | $64.00 | $5.00 |
| `gpt-realtime-mini` (deprecated) | $0.60 | $0.06 | $2.40 | $10.00 | $0.30 | $20.00 | $0.80 |

Verbatim rows from the docs pricing table: "| gpt-realtime-2.1 | Audio | $32.00 | $64.00 | $0.40 | … | gpt-realtime-2.1 | Text | $4.00 | $24.00 | $0.40 | … | gpt-realtime-2.1-mini | Audio | $10.00 | $20.00 | $0.30 | … | gpt-realtime-2.1-mini | Text | $0.60 | $2.40 | $0.06 |"
openai.com business pricing (verbatim): "GPT-Realtime-2.1 … Audio: $32.00 / 1M tokens for inputs $0.40 / 1M tokens for cached inputs $64.00 / 1M tokens for outputs Text: $4.00 / 1M tokens for inputs $0.40 / 1M tokens for cached inputs $24.00 / 1M tokens for outputs" and "GPT-Realtime-2.1 mini … Audio: $10.00 … $0.30 … $20.00 Text: $0.60 … $0.06 … $2.40"

### Transcription models
Source: https://developers.openai.com/api/docs/pricing ("Transcription models")
> "| gpt-live-transcribe | Live transcription | - | - | $0.017 / minute | gpt-realtime-whisper | Live transcription | - | - | $0.017 / minute | gpt-transcribe | Transcription | - | - | $0.0045 / minute | gpt-4o-transcribe | Transcription | $2.50 | $10.00 | $0.006 / minute | gpt-4o-mini-transcribe | Transcription | $1.25 | $5.00 | $0.003 / minute | gpt-4o-transcribe-diarize | $2.50 | $10.00 | $0.006 / minute | Whisper | Transcription | - | - | $0.006 / minute |"

### Per-minute equivalence
- The docs give **no** per-minute figure for the token-billed realtime models. They do state the token rate: "Audio tokens in user messages are 1 token per 100 ms of audio, while audio tokens in assistant messages are 1 token per 50ms of audio." (cost guide). *Derived (not from docs):* 600 input audio tokens/min → ~$0.0192/min at $32/1M; 1,200 output audio tokens/min → ~$0.0768/min at $64/1M for gpt-realtime-2.1; context re-sent each turn is additional.
- GPT-Live is per-minute: "gpt-live-1 | $0.05" per minute, "billed per second, without rounding up to a whole minute" (https://developers.openai.com/api/docs/pricing). WebRTC session creation "bills 15 seconds of voice duration during initialization. That amount is credited against duration charges once the session starts running" (https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=live).

### Caching
> "Realtime API supports prompt caching, which is applied automatically … The best strategy for maximizing cache rate is keep a session's history static." (https://developers.openai.com/api/docs/guides/voice-latency-cost?api=realtime)

---

## 8. Web search via the Responses API

Source: https://developers.openai.com/api/docs/guides/tools-web-search

### Tool type name
> "For new Responses API integrations, use `{ "type": "web_search" }`. The earlier `web_search_preview` tool remains available for legacy integrations, but it does not support newer controls such as `filters`, `external_web_access`, and `return_token_budget`."
> "The Responses API still accepts `web_search_preview` for legacy integrations, but use `web_search` for new integrations."

### Models
> Recommended path table: "New web search integration | Responses API with `web_search` and `gpt-5.5`"; guide examples use `model: "gpt-6-astra"`.
> Limitations table (Responses): "`gpt-4.1` | 1M | Search context is limited to 128k · `gpt-4.1-mini` | 1M | Search context is limited to 128k · `o4-mini` | 200k | … deprecated, shutdown 2026-10-23"
> "Web search does not support `gpt-5` with `minimal` reasoning. … `gpt-5.4` with reasoning effort set to `none` may produce lower-quality results. … For Responses API web search, the search context window is limited to 128k, even when the model context window is larger."
> "With `tool_choice: "auto"`, search is optional. Use `tool_choice: "required"` or a specific web search tool choice when search must run."
Model pages listing `web_search` under "Supported tools": `gpt-6-luna` (https://developers.openai.com/api/docs/models/gpt-6-luna), `gpt-5.6-luna`, `gpt-5-mini`, `gpt-5-nano`. (gpt-4o-mini and gpt-4.1-mini are deprecated, shutdown Jan 14, 2027, replacement `gpt-6-luna` — deprecations page.)
Chat Completions path: "`gpt-5-search-api` | 200k"; `gpt-4o-search-preview`/`gpt-4o-mini-search-preview` "deprecated and shut down on 2026-07-23".

### Request shape
Verbatim examples:
```js
tools: [{ type: "web_search" }]
tools: [{ type: "web_search", search_context_size: "low" }]
tools: [{ type: "web_search", user_location: { type: "approximate", country: "GB", city: "London", region: "London" } }]
```
> "`search_context_size` controls how much context from web search results is made available to the model before it generates a response. Use `low` for simple lookups, `medium` for a balanced default, and `high` when the answer may require more detail"
> "The `city` and `region` fields are free text strings … The `country` field is a two-letter ISO country code, like `US`. The `timezone` field is an IANA timezone like `America/Chicago`."

### Response shape
> "A `web_search_call` output item with the ID of the search call, along with the action taken in `web_search_call.action`. The action is one of: `search` … `open_page` … `find_in_page` … A `message` output item containing: The text result in `message.content[0].text`; Annotations `message.content[0].annotations` for the cited URLs"
> "the `url_citation` annotation object will contain the URL, title and location of the cited source."
```json
{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "On March 6, 2025, several news...",
  "annotations": [{"type": "url_citation", "start_index": 2606, "end_index": 2758, "url": "https://...", "title": "Title..."}]}]}
```
SDK convenience `response.output_text` is used in all examples (`console.log(response.output_text)`).
> "When displaying web results or information contained in web results to end users, inline citations must be made clearly visible and clickable in your user interface."

### Price per call
Source: https://developers.openai.com/api/docs/pricing ("Tools")
> "Web search (all models) | $10.00 / 1k calls + Search content tokens billed at model rates."
> "Web search preview (reasoning models, including `gpt-5`, `o-series`) | $10.00 / 1k calls + Search content tokens billed at model rates." · "Web search preview (non-reasoning models) | $25.00 / 1k calls + Search content tokens are free."
> "Web search content tokens are tokens retrieved from the search index and fed to the model alongside your prompt to generate an answer. For gpt-4o-mini and gpt-4.1-mini with the non-preview web search tool, search content tokens are billed as a fixed block of 8,000 input tokens per call."
Also from the guide: "Search actions incur a tool call cost".
**Discrepancy:** openai.com/business/pricing says "Web search … $10.00 / 1k calls Search content tokens are free." The developer pricing page says content tokens are billed at model rates. Budget for the developer-docs version.

### Cheapest reasonable model for short factual lookups (news/weather/sports)
`gpt-6-luna` — https://developers.openai.com/api/docs/models/gpt-6-luna
> "Our most efficient model for focused, high-volume tasks. … `reasoning.effort` supports `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`. Use the Responses API for built-in tools and function calling." Supported tools include "web_search". Pricing: "Input $0.1 … Cached input $0.01 … Cache writes $0.125 … Output $0.5" per 1M tokens; "1,050,000 context window"; "May 18, 2026 knowledge cutoff".
Alternatives: `gpt-5.6-luna` $0.20 in / $0.02 cached / $1.20 out (https://developers.openai.com/api/docs/models/gpt-5.6-luna); `gpt-5-nano` $0.05 / $0.005 / $0.40 lists web_search but its only snapshot `gpt-5-nano-2025-08-07` is deprecated (shutdown Dec 11, 2026 → `gpt-5.6-luna`).

---

## 9. Chat/text model for background summarization

| Model | Input | Cached | Output | Status | Source |
|---|---|---|---|---|---|
| **`gpt-6-luna`** (recommended) | $0.10 | $0.01 | $0.50 | current; 1.05M ctx; "most efficient model for focused, high-volume tasks" | https://developers.openai.com/api/docs/models/gpt-6-luna |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | current; "roughly corresponds to the nano model tier used in earlier GPT-5 families" | https://developers.openai.com/api/docs/models/gpt-5.6-luna |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 | snapshot `gpt-5-nano-2025-08-07` deprecated, shutdown Dec 11, 2026 → `gpt-5.6-luna`; page says "For most new speed- and cost-sensitive workloads, we recommend starting with GPT-5.6 Luna" | https://developers.openai.com/api/docs/models/gpt-5-nano |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 | snapshot `gpt-5-mini-2025-08-07` deprecated, shutdown Dec 11, 2026 → `gpt-5.6-terra` | https://developers.openai.com/api/docs/models/gpt-5-mini |
| `gpt-4.1-mini` | $0.40 | $0.10 | $1.60 | deprecated, shutdown Jan 14, 2027 → `gpt-6-luna` | https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/deprecations |

Pricing-page verbatim: "| gpt-6-luna | $0.10 | $0.50 | $0.01 | …" (short-context input / output / cached), "| gpt-5-mini | $0.25 | $2.00 | $0.025 |", "| gpt-5-nano | $0.05 | $0.40 | $0.005 |", "| gpt-4.1-mini | $0.40 | $1.60 | $0.10 |". Batch and Flex: "priced at 50% of Standard rates" (gpt-6-luna page) — useful for non-urgent memory extraction.

---

## Supplementary: GPT-Live (for architecture awareness)
Source: https://developers.openai.com/api/docs/guides/audio
> "For a new conversational voice application, start with **GPT-Live**. It can listen while speaking and keep the conversation moving while a backend agent reasons, uses tools, or completes a task."
Source: https://developers.openai.com/api/docs/models/gpt-live-1 — "Model ID: `gpt-live-1` … full-duplex voice model … Voice sessions cost $0.05 per minute, billed per second. Backend model and tool usage is billed separately." GA Sep 10, 2026 (changelog). Connection: `POST /v1/live/sessions` with `{session: {...}, transport: {type: "webrtc", sdp}}`, data channel `oai-events`, wait for `session.started`; backend via `delegation: { type: "responses", responses: { model, tools: [{ type: "web_search" }] } }` (https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=live). Rate limit: "Build 50 concurrent sessions". This is a *different* API/event surface from Realtime ("Sharing a transport does not make GPT-Live and Realtime handshakes, credentials, or event formats interchangeable.").

---

## Unverified / could not confirm

1. **`?model=` query parameter on `POST /v1/realtime/calls`** — not shown anywhere in the WebRTC guide or the calls reference; model is documented only inside the `session` object (client_secrets body or multipart `session` field). Whether a query param is also accepted is unconfirmed.
2. **Voice gender** — the docs contain no male/female labelling for `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar`.
3. **`gpt-transcribe` as input-transcription model over WebRTC** — the session schema lists it as a valid `audio.input.transcription.model`, but the realtime-transcription guide says the committed-turn `gpt-transcribe` workflow "requires a WebSocket connection", and the gpt-transcribe model page marks `v1/realtime` "Not supported" while marking `v1/realtime/transcription_sessions` "Supported". Behaviour in a WebRTC speech-to-speech session is therefore unconfirmed; `gpt-realtime-whisper` or the (deprecated) `gpt-4o-mini-transcribe` are the unambiguous choices.
4. **`max_output_tokens` upper bound for 2.x models** — the schema says "integer between 1 and 4096 … or `inf`", while gpt-realtime-2.x model pages state "32,000 max output tokens". Not reconciled in the docs.
5. **Default `noise_reduction` setting** — the schema describes `near_field`/`far_field` and how to disable, but does not state the default when omitted (the generic example response shows `near_field`). Unconfirmed.
6. **Web search content-token billing** — developer pricing page: "Search content tokens billed at model rates"; openai.com business pricing: "Search content tokens are free". Conflicting; could not resolve.
7. **`response.cancelled` event** — mentioned in the conversations guide prose, but not present as a heading in the server-events reference (which documents cancellation via `response.done` with `status: "cancelled"`). Treat `response.done` as authoritative.
8. **Dated snapshots for `gpt-realtime-2.1` / `-2.1-mini`** — none listed; only the alias names are published.
9. **Exact release date of `gpt-realtime-2.1`** — changelog entry sits under "July, 2026 / Jul 6"; not cross-checked with a blog post.
10. `platform.openai.com/docs/...` pages could not be read at that hostname; they redirect to `developers.openai.com/api/docs/...`, which is what was fetched.
