# Security and privacy

Companion handles personal stories from people who may be vulnerable. The
following is what the MVP does, what it does not do, and what must change before
production.

## Secrets

- `OPENAI_API_KEY`, `DATABASE_URL` and `AUTH_SECRET` are read only in server code
  (route handlers and `src/lib/**` server modules). No `NEXT_PUBLIC_` variable
  carries a secret. The browser never receives the API key; it receives a
  short-lived Realtime **client secret** (`ek_…`, 10-minute TTL) minted by
  `/api/realtime/session` and scoped to one session configuration.
- `.env*` files are git-ignored. `.env.example` documents every variable.
- Logs are structured and redacted (`src/lib/privacy/logging.ts`): API keys,
  client secrets, connection strings, emails, bearer tokens and any field named
  like `content`, `transcript`, `password`, `token` are replaced with
  `[redacted]`. Transcripts and memory contents are never logged.
- A build-time check (`npm run check:secrets`, see `docs/TEST_PLAN.md`) greps the
  client bundles for `sk-`, `postgres://` and the test secrets.

## Authentication and authorization

- Email + password accounts: bcrypt (cost 12), generic failure messages, rate
  limited (10/min per IP). Sessions are signed JWTs (HS256, `AUTH_SECRET`) in an
  `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie, 7-day expiry, carrying
  the user's `token_version`; bumping it revokes all sessions.
- **Demo profiles are not authentication.** They are seeded, clearly labeled
  fictional users that anyone can open when `COMPANION_ENABLE_DEMO_PROFILES=true`.
  They never use the paid API. Disable them in any real deployment.
- Every table that holds user data carries `user_id`; every repository function
  takes the authenticated user's id and filters by it. Cross-user access returns
  404, and integration tests assert it (`tests/integration/isolation.test.ts`).

## Input validation and abuse limits

- Every request body is validated with zod schemas in `src/lib/api/contracts.ts`;
  unknown fields are rejected where `.strict()` is used.
- Rate limiting is an in-memory token bucket per route group and user/IP. It is
  **per server instance**; on a multi-instance deployment use a shared store.
- Cost caps (`docs/COST_MODEL.md`) refuse new live sessions once the daily or
  per-user estimated spend is exceeded.
- Tool calls from the model are validated (zod per tool), authorized against the
  conversation's owner, and rate limited (60/min/user). Web search receives only
  the model's query string, never memories, and only when the user consented.

## Consent model

| Scope | Grants |
|---|---|
| `memory` | Storing personal facts, interests, stories, preferences between chats |
| `sensitive_memory` | Storing health, finances, grief, family conflict |
| `web_search` | Sending the model's query (never memories) to web search. **On by default** (opt-out in Settings) |
| `transcripts` | Keeping full transcripts (otherwise summaries only) — reserved |

Memory scopes are opt-in; web search is opt-out because nothing private leaves the app
through it. Consent is recorded as an append-only `consent_records` row with its source
(`ui`, `voice` with the user's quoted words, or `seed` for demo profiles) and
mirrored into `preferences` for fast checks. Revoking memory consent stops
injection immediately; existing memories remain visible and deletable.

### Style profile

The conversation-style profile (`personality_profiles`) and the per-turn tone
observations (`tone_events`) are **covered by the `memory` consent scope**; no new
scope was added. They are inferred — from the words of transcripts, never from
audio — and are labelled as such wherever they appear.

| Data | Written when | Read when | Removed by |
|---|---|---|---|
| `personality_profiles` (trait scores, humor styles, topics, expressions, pace, notes, tone/intent frequencies, optional model summary) | A conversation ends with memory on and ≥ 3 user messages | Live session minting (prompt block, memory on only); demo brain (memory on only); `GET /api/profile/style`; export | `DELETE /api/profile/style` ("Reset this" on the memory page); account deletion (FK cascade) |
| `tone_events` (tone, intensity, intent, ≤200-char cue, source `model` / `heuristic`) | Live: the model calls `observe_tone` and memory is on. Demo: every user turn, memory on | Conversation end (profile frequencies, "how it felt"); `GET /api/profile/style` (last 20, **cues never returned**); export | Same reset; account deletion (cascade); conversation deletion (cascade) |

With memory off nothing is written: the live `observe_tone` tool still answers
with behavioural guidance for the current conversation but stores nothing, and
the demo brain still adapts its reply without storing. The model-assisted
analysis (live only) is instructed to describe style, not facts, and to omit
health, medication, finances, grief, family conflict and protected
characteristics; the parser additionally drops any topic, note, phrase or summary
that the sensitivity classifier flags. The heuristic never lists a sensitive word
as a topic. Logs record counts and durations only, never cues or transcript text.

## Provenance and the right to be forgotten

- Memories are labeled `confirmed`, `reported`, `summarized` or `inferred` and the
  API refuses to promote a label except through an explicit user confirmation.
  `inferred` items are never injected into a model session.
- Deleting a memory soft-deletes it, writes a **tombstone** (normalized text and
  keywords — never the user's name), redacts matching sentences from existing
  summaries, and causes any later attempt to save a matching fact by the model
  (unconfirmed) or by summarization to be rejected. **Only an explicit user
  action can override a tombstone**: a confirmed save (the memory page, or a
  statement the user explicitly asked to have remembered) retires the matching
  tombstones and is logged as `corrected`. Summarization and unconfirmed model
  saves never can. See `docs/DECISIONS.md`.
- Summaries are labelled `sensitive` when they carry health, finances, grief or
  family-conflict signals and are injected only with `sensitive_memory` consent;
  without it the summarizer is instructed to omit such details and the heuristic
  summary drops them.
- Export: `GET /api/memory/export` returns every row that belongs to the user.
- Delete account: `DELETE /api/account` removes the user row; all user data
  cascades. The exception is `usage_events`: those rows hold no content (model id,
  token counts, durations, estimated cost) and are kept with `user_id` set to
  NULL so the operator's daily cost cap stays accurate. Deleted users cannot sign in.

## Data in transit and at rest

- TLS is provided by the hosting platform (Vercel) and by Supabase for Postgres
  (`sslmode=require`). Locally, Postgres runs on loopback without TLS.
- Audio is streamed browser ↔ OpenAI directly over WebRTC (DTLS-SRTP); the
  application server never receives audio. Transcripts are stored in Postgres
  when the client posts them.
- No voice biometrics, no voice cloning, no speaker identification.

## Safety

The system prompt instructs the companion to respond to distress with warmth and
to point to a trusted person or a doctor, to advise calling emergency services
first when emergency signals appear, and never to present itself as a therapist
or clinical service. The demo brain has a keyword-based version of the same rule.
This is **not** clinical care and should not be marketed as such.

## Before production (not done in the MVP)

- Shared rate-limit store (Redis) and per-IP limits at the edge.
- Email verification and password reset flows.
- Content-Security-Policy header with nonces (currently basic hardening headers
  only, see `next.config.ts`).
- Audit logging of memory access, retention jobs
  (`src/lib/privacy/retention.ts` is a helper, not scheduled), and a privacy policy.
- Encryption at rest for memory contents beyond the database's own.
