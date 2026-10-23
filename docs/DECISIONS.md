# Decisions

Running log of architecture and product decisions. Newest first.

## 2026-10-23 — Integration

- **Model IDs are `gpt-realtime-2.1` / `gpt-realtime-2.1-mini`,** transcription `gpt-realtime-whisper`, text `gpt-6-luna`. The names in the original brief (`gpt-realtime`, `gpt-realtime-mini`) are deprecated with a 2027-01-20 shutdown; verified in `docs/API_VERIFICATION.md`.
- **Transcript rehydration ignores memory consent.** `buildMemoryContext` gates stored facts and summaries on memory consent, but always includes the tail of the conversation being continued: that transcript is the live conversation, not memory, and a model switch must not amnesia the user who declined memory.
- **Demo brain callbacks speak in the second person, or quote.** Stored memories are statements about the user; a heuristic converter rewrites them ("you tend a garden… your pride"). Subject pronouns are left alone for memories about other people (family, friends, stories) because "he is a beagle" is about the dog. When the result does not start with "you/your", the brain quotes the note rather than mangling it.
- **Malformed ids are 404s.** Route ids are UUID-checked before hitting Postgres so a bad id cannot surface a database error.
- **E2E runs start from a truncated, re-seeded test database** (`scripts/e2e-reset.ts` via Playwright `globalSetup`). Tombstones are deliberately persistent, so a previous run's deletions would otherwise block a later run's saves.
- **Demo sign-in has its own rate-limit bucket** (30/min/IP) separate from password auth (10/min/IP): there is no password to brute-force and shared devices sign in often.

## 2026-10-22 — Foundation

- **Next.js 16 App Router, Cache Components disabled.** Every page is auth-gated and dynamic; PPR/`use cache` adds complexity for no benefit in an MVP. Can be enabled later per route.
- **Plain SQL migrations + `pg`, no ORM.** Schema is small and explicit; hand-written SQL keeps per-user scoping visible in every query, which is the main security property we must be able to audit. Migration runner is ~60 lines (`src/lib/database/migrate.ts`).
- **Stateless signed session cookie (jose, HS256) + `token_version` on users.** No session table needed; bumping `token_version` revokes everything. Demo profiles use the same mechanism with `is_demo = true`.
- **Demo mode runs a server-side "demo brain" against the same memory store.** This lets memory consent, recall, correction and model-switch rehydration be exercised and tested without any paid API, and is labeled *Simulated* everywhere in the UI.
- **Memory deletion uses tombstones + summary suppression.** Deleting a memory writes a `memory_tombstones` row with its normalized text and keywords. Retrieval filters any summary containing tombstoned keywords, and extraction refuses to re-create a fact matching a tombstone. Summaries are additionally redacted/regenerated on delete. This is how "deleted facts are not restored from summaries" is enforced rather than hoped for.
- **Provenance labels are a one-way street.** `inferred -> confirmed` only via an explicit user action (UI confirm or a spoken yes captured as a `record_consent`/`remember` tool call with `user_confirmed: true`). The API refuses other status changes.
- **Pause sensitivity maps to Realtime `semantic_vad.eagerness`** (patient = low, balanced = medium, quick = high) with `server_vad` as a fallback option. Semantic VAD is chosen because older adults with hesitant speech are the primary users.
- **Fred and Ethel** are the two companion voices (male-leaning and female-leaning OpenAI voices). The persona name shown and spoken follows the selected voice. OpenAI does not label voice gender; the assignment is ours and documented in `src/lib/ai/models.ts`.
- **Web search via OpenAI Responses `web_search` tool, server-side only.** Same vendor, same key, citations returned as `url_citation` annotations and shown in the transcript. The Realtime model calls our `search_web` function; the server runs the search and never includes memories in the query.
- **Hosting:** the development container has no public URL. Target: Vercel (app) + Supabase Postgres (data), deployed only with the user's tokens and explicit approval. See `PREVIEW.md`.
