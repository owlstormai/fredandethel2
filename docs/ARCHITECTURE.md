# Architecture

Companion is a Next.js 16 application (App Router, TypeScript, Tailwind 4) with
Postgres for durable, **application-owned** memory. The browser talks to OpenAI's
Realtime API directly over WebRTC for audio; everything else (auth, memory,
consent, tools, usage) goes through our own server routes.

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│  Orb (canvas, Web Audio analyser)   VoiceSession (controls, captions)    │
│  ConversationAdapter ◄── OpenAIRealtimeAdapter | DemoAdapter             │
│        │ WebRTC audio + "oai-events" data channel        │ fetch        │
└────────┼─────────────────────────────────────────────────┼──────────────┘
         ▼                                                 ▼
  OpenAI Realtime API                           Next.js route handlers (/api/*)
  (gpt-realtime-2.1 / -mini)                    auth · me · preferences · consent
                                                 realtime/session (mints ek_ secret)
                                                 tools/dispatch (remember, search…)
                                                 conversations · demo/turn · memories
                                                 usage · models · health
                                                        │
                                                        ▼
                                          Postgres (users, profiles, preferences,
                                          consent_records, conversations,
                                          conversation_messages, memories,
                                          memory_tombstones, memory_events,
                                          model_configs, usage_events)
```

## Modules

| Path | Responsibility |
|---|---|
| `src/components/orb` | Canvas orb, state grammar, `useAudioLevel` (Web Audio RMS) |
| `src/components/voice` | Voice session UI, controls, captions, consent card, model switcher, comparison mode |
| `src/components/settings`, `memory`, `developer` | Settings, memory inspector, developer usage panel |
| `src/components/providers` | `PreferencesProvider` (loads `/api/me`, applies theme attributes) |
| `src/lib/ai/adapters` | `ConversationAdapter` contract; live (WebRTC) and demo adapters; server-side demo brain |
| `src/lib/ai/realtime` | Typed Realtime events, WebRTC client, conversation state reducer, session config builder |
| `src/lib/ai/tools` | Tool definitions (function calling), server dispatcher, web search |
| `src/lib/ai/instructions.ts` | Personality / onboarding / safety system prompt builder |
| `src/lib/ai/summarize.ts` | Post-conversation summary + candidate memories (text model) |
| `src/lib/memory` | Repository, normalization, keyword retrieval, tombstones, summary suppression, export, service (consent + provenance rules) |
| `src/lib/database` | `pg` pool, migrations, repositories |
| `src/lib/auth` | Password hashing, signed-cookie sessions, demo profiles |
| `src/lib/usage` | Pricing math, usage recording, caps, summaries |
| `src/lib/privacy` | Redacting logger, rate limiter, retention helper |
| `src/lib/api` | zod contracts, response helpers, browser fetch client |

## Key flows

### Live conversation
1. `POST /api/realtime/session` — authenticates the user, checks cost caps, builds
   the memory block (`buildMemoryContext`), the instructions and tool list, creates a
   `conversations` row, and calls `POST /v1/realtime/client_secrets` with the full
   session config (`type: "realtime"`, model, voice, `semantic_vad`, transcription,
   tools). Returns the ephemeral `ek_…` secret, never the API key.
2. The browser acquires the microphone, creates an `RTCPeerConnection`, adds the
   mic track, opens the `oai-events` data channel, and posts its SDP offer to
   `https://api.openai.com/v1/realtime/calls` with the ephemeral secret.
3. Server events on the data channel drive the state reducer → orb state and
   captions. `input_audio_buffer.speech_started` while the assistant is speaking
   triggers `response.cancel` + `output_audio_buffer.clear` (barge-in).
4. Function calls (`response.function_call_arguments.done`) are posted to
   `POST /api/tools/dispatch`, which validates, authorizes, executes (memory
   service, web search) and returns output the adapter sends back as
   `function_call_output` followed by `response.create`.
5. Transcripts, usage (`response.done.usage`), speech durations and connected time
   are batched to `POST /api/conversations/:id/events`.
6. Ending posts to `/api/conversations/:id/end`, which summarizes (text model or
   heuristic), stores a `summary` memory and `inferred`/`reported` candidates
   (only if memory is on), and returns them for the user to confirm or dismiss.

### Model switching
Realtime sessions are bound to one model. Switching disconnects and mints a new
session with `continueConversationId`; `buildMemoryContext` then includes the
recent transcript of that conversation together with memories and summaries, so
the new model continues the same conversation with the same application-owned
context. Hidden model state does not transfer and the UI says so.

### Demo mode
`DemoAdapter` uses browser speech recognition/synthesis when available (and typed
input otherwise) and posts each utterance to `POST /api/demo/turn`. The
server-side **demo brain** is rule-based, uses the **same memory service** and
consent rules, and returns tool calls and UI actions in the same shapes the live
path uses. It is labeled "Simulated" everywhere.

## Memory model
See `docs/DECISIONS.md` (tombstones, provenance) and `docs/SECURITY.md` (consent).
Retrieval is keyword-based and bounded (~1,200 tokens); vector search was not
needed at MVP scale.

## Portability
No Vercel- or Supabase-specific APIs are used. Any Postgres 15+ works
(`docker-compose.yml` provided). The app runs with `npm run dev` locally.
