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
                                          personality_profiles, tone_events,
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
| `src/lib/ai/personalityModel.ts` | Model-assisted conversation-style analysis (live only; words, not audio) |
| `src/lib/memory` | Repository, normalization, keyword retrieval, tombstones, summary suppression, export, service (consent + provenance rules) |
| `src/lib/memory/personality.ts`, `tone.ts`, `personalityService.ts` | Conversation-style profile heuristics and merge; lexical tone/intent classifier; consent-gated profile + tone-event use-cases |
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

## Conversation-style profile

Besides *what* the user has told us (memories), the app keeps a small,
application-owned picture of *how they like to talk*: `personality_profiles`
(one row per user; `traits` jsonb typed as `StyleProfileTraits`). It is labelled
**inferred** everywhere, and it is inferred from **words only**. The Realtime
API hands the app transcripts, not prosody, so the signals are lexical:
laughter markers ("haha", "lol"), joke cues ("kidding", "pun"), exclamation and
question density, words per message, story cues ("back when", "I remember",
sequencing words with past tense), warmth vocabulary ("thank you", "dear"),
contractions and slang versus formal words, imperatives and short declaratives.
Nothing is derived from pitch, pace, volume or any audio feature, and the UI,
the prompt block and this document say so.

- **Computation.** `finishConversation` runs after the summary step. With memory
  on and at least three user messages, `analyzeStyleHeuristic` scores eight
  traits 0..1 (humor, energy, formality, verbosity, warmth, curiosity,
  storytelling, directness), picks humor styles, favourite topics (surface forms,
  sensitive words such as health/money/grief never qualify), repeated 2–3-gram
  expressions, a pace and ≤5 notes. For a **live** conversation the cheap text
  model also reads the transcript (`analyzeStyleWithModel`, strict JSON, the
  heuristic as a hint, forbidden to mention health, finances, grief, family
  conflict or protected characteristics; usage recorded as `summary` with
  `purpose: "style"`). Demo conversations never pay: heuristic only.
- **Merge.** Scores move by an exponential moving average with weight
  `max(confidence × 0.5, share-of-evidence × 0.5)`, capped at 0.5, where
  confidence grows from 0 (<3 messages) to ~1 (≥40). One conversation can never
  flip a profile; a young profile learns faster than a mature one. Topics,
  phrases and humor styles are a capped union, newest first; notes are replaced.
  Each update logs `memory_events` (`created` first, then `corrected`) with
  `payload.kind = "personality"`.
- **Use.** `describeStyleForPrompt` renders ≤ ~120 tokens of plain English into
  the live system prompt as "# How they like to talk" (only when memory is on
  and the profile rests on ≥6 messages), e.g. *"How they like to talk (inferred
  from their words, not their voice): They joke back readily (playful, wordplay);
  match it when humor is on. They ask a lot of questions; answer briefly, then
  return one. Favorite topics: garden, weeds, tomatoes."* The demo brain reads
  the same profile: a humor score ≥ 0.6 steps gentle humor up to playful's quip
  rate, verbosity ≥ 0.6 picks the "long version" reflective templates.
- **Control.** `GET /api/profile/style` returns the profile, plain-language rows
  (`describeStyleForUser`) and the last 20 tone observations; the memory page
  shows it as the "How you like to talk" card with an *Inferred* badge, the
  evidence count and a **Reset this** button (`DELETE /api/profile/style`, which
  also deletes the tone events). It is part of the export (`personality`,
  `toneEvents`) and cascades with account deletion.

## Three-channel listening

The companion listens on three channels: **what** is said (context — the
transcript and the memory store), **how** it is said (tone: humor, warmth,
frustration, upset, anxiety, confusion, fatigue, joy, neutral) and **why** it is
said (intent: venting, seeking information, wanting company, reminiscing, asking
for help, seeking reassurance, joking, planning, small talk). Channels 2 and 3
are stored as `tone_events` rows (tone, intensity 0..1, intent, a ≤200-char cue,
source) — only when memory is on.

- **Live mode hears the voice through the model.** The Realtime model receives
  the audio, so prosody is available *to it*. The system prompt section
  "# Three-channel listening" tells it to call the `observe_tone` function tool
  when tone or intent is notable or changes (a few times per conversation at
  most) and how to adjust (frustration → fewer questions, acknowledge, slow
  down; sadness → warmth, no humor, one gentle question; confusion → shorter
  sentences; fatigue → offer to wrap up; venting → listen, don't fix; and so on).
  The dispatcher stores the observation (`source: "model"`) when memory is on and
  answers "Noted." — or, for an explicit `serious` flag or distress at intensity
  ≥ 0.6, "Noted. Drop humor for the rest of this conversation and slow down."
  It never changes the saved humor preference; the adjustment lives in the
  model's own context for that conversation. When memory is off the tool still
  answers behaviourally but stores nothing.
- **Demo mode infers from text, and says so.** Every typed/recognised turn goes
  through `classifyTone` (lexical cues: "ugh", "frustrating", "nothing works" →
  frustration; "haha", "kidding" → humor; "worried", "scared" → anxiety; "I
  don't understand" → confusion; "tired", "exhausted" → fatigue; and so on,
  with intents from question shapes, "remember when", "help me", "do you think
  I", greetings). Distress at intensity ≥ 0.5 takes the serious path (humor off
  for the conversation, warmth, one question); confusion gets a shorter reply;
  fatigue an offer to wrap up. Notable turns show in the transcript as an
  `observe_tone` tool call ("Listening to how you sound…") exactly as the live
  path would.
- **Aggregation.** On conversation end the profile's `tones` / `intents`
  frequencies are recomputed from the last 200 tone events; a dominant tone or
  intent adds one sentence to the prompt block ("They often come to vent rather
  than to be fixed; listen first."). The session summary shows a one-line *How it
  felt (inferred)* built from that conversation's events; the memory card lists
  recent observations ("What I've noticed lately") without cues.

## Portability
No Vercel- or Supabase-specific APIs are used. Any Postgres 15+ works
(`docker-compose.yml` provided). The app runs with `npm run dev` locally.
