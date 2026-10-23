# Companion

A voice-first AI conversation companion designed for older adults: a calm, dark
interface with a luminous audio-reactive orb, real two-way speech over the OpenAI
Realtime API, and **memory that belongs to the app, not to the model** — with
explicit consent, provenance labels, and a real right to be forgotten.

Two companion voices: **Fred** and **Ethel**.

> Status: MVP. Read `PREVIEW.md` for what was verified, `docs/TEST_PLAN.md` for
> test results, and the "Limitations" section below before trusting any claim.

## Modes

| Mode | Needs | What it is |
|---|---|---|
| **Demo** | nothing | Seeded fictional profiles (Margaret, Walter), simulated conversation from a rule-based "demo brain" that uses the real memory store, browser speech where available. Labeled *Simulated* everywhere. |
| **Live** | `OPENAI_API_KEY` | Your own account, real audio to `gpt-realtime-2.1` / `gpt-realtime-2.1-mini` over WebRTC, semantic turn detection, barge-in, tools (memory, web search), usage and cost tracking. |

## Quick start (local)

Requirements: Node 22+, Postgres 15+ (or Docker).

```bash
git clone <this repo> && cd companion
cp .env.example .env.local        # edit DATABASE_URL (and OPENAI_API_KEY for live mode)
docker compose up -d              # local Postgres on 5432 (skip if you have one)
npm install
npm run db:migrate
npm run db:seed                   # model configs + demo profiles
npm run dev                       # http://localhost:3000
```

Open http://localhost:3000, pick a demo profile or create an account, and press
**Start talking**. The microphone needs `localhost` or HTTPS.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` / `db:seed` / `db:reset` | Schema and seed data (`db:reset` only on test DBs) |
| `npm run typecheck` / `lint` | Static checks |
| `npm run test` | Unit + integration (needs `companion_test` DB, see `.env.test`) |
| `npm run test:e2e` | Playwright with a fake microphone (`E2E_FAKE_AUDIO=tests/fixtures/fake-mic.wav` to feed speech) |
| `npm run verify` | Checklist: env, DB, OpenAI key, model availability, client-secret mint |
| `npm run check:secrets` | Greps the built client bundle for secrets |

## Configuration

See `.env.example`. Secrets are server-only. Pricing assumptions and model IDs
live in `src/lib/ai/models.ts` and can be overridden with environment variables.

## Screenshots

`docs/screenshots/` — landing (desktop and phone), the nine orb states, the talk screen
mid-conversation (desktop and phone), the session summary, settings, memory inspector
and the developer panel.

## Documentation

- `PREVIEW.md` — verified environment facts, local preview, deployment path
- `docs/ARCHITECTURE.md` — modules and flows
- `docs/SECURITY.md` — secrets, auth, consent, deletion, limits
- `docs/COST_MODEL.md` — what is billed and how estimates are computed
- `docs/TEST_PLAN.md` — acceptance tests mapping and latest results
- `docs/DECISIONS.md` — decision log
- `docs/API_VERIFICATION.md` — OpenAI API facts verified against current docs with sources
- `AGENTS.md` — the product brief this was built from

## What works, what is simulated, what needs credentials

| Area | Status |
|---|---|
| UI, orb, settings, memory inspector, developer panel | Working, verified in Chromium (screenshots in `docs/screenshots/`) |
| Demo mode conversation, onboarding, memory consent/recall/forget, humor level, serious-topic handling, gentle disagreement | Working; **rule-based and labeled Simulated** |
| Memory store, provenance labels, tombstones, summary suppression, export, delete account, per-user isolation | Working, integration-tested against Postgres |
| Live mode: ephemeral key minting, WebRTC client, barge-in, semantic VAD config, tools, usage/cost | Built to the verified API docs and unit-tested with scripted events; **not yet exercised against the real API** (no key in the build environment) |
| Web search (Responses `web_search`), AI summaries | Same as above; degrade gracefully without a key |
| Hosting | No public URL from the build container; Vercel + Supabase path documented in `PREVIEW.md`, not deployed |

## Limitations

- Live mode needs `OPENAI_API_KEY`; run `npm run verify` first, then the live e2e test.
  Until that runs, treat live-mode claims as unverified.
- The demo brain is a small deterministic script. It is honest about memory and consent
  but it is not an AI; its replies are templated.
- Demo voice input uses the browser's speech recognition, which exists only in
  Chromium-based browsers; elsewhere the demo is typed. Demo voice output uses browser
  speech synthesis when voices are available.
- Deleting a memory writes a keyword tombstone. A very generic deleted fact (for example
  "likes tea") can block similar future facts until it is cleared; there is no
  clear-tombstone UI yet.
- Rate limits are per server instance; there is no email verification or password reset;
  the CSP header is basic. See `docs/SECURITY.md` for the production checklist.
- Model switching rehydrates application-owned context (memories, summaries, recent
  transcript). Hidden model state does not transfer and the UI says so.
- The side-by-side comparison runs two real sessions and bills both.
- Costs are estimates from configured per-token prices; no real billing.
- Fred and Ethel map to OpenAI's `cedar` and `marin` voices; OpenAI does not label voice
  gender, so the pairing is ours and configurable.
