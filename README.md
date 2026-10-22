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

## Documentation

- `PREVIEW.md` — verified environment facts, local preview, deployment path
- `docs/ARCHITECTURE.md` — modules and flows
- `docs/SECURITY.md` — secrets, auth, consent, deletion, limits
- `docs/COST_MODEL.md` — what is billed and how estimates are computed
- `docs/TEST_PLAN.md` — acceptance tests mapping and latest results
- `docs/DECISIONS.md` — decision log
- `docs/API_VERIFICATION.md` — OpenAI API facts verified against current docs with sources
- `AGENTS.md` — the product brief this was built from

## Limitations

_Filled in from the final verified report; see the bottom of `docs/TEST_PLAN.md`._
