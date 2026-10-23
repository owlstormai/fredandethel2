# Preview and hosting — verified status

This file records what was actually verified about running and sharing Companion.
Nothing here is a claim about a hosting service we did not test.

## The development environment (verified 2026-10-22)

The build ran in a Claude Code cloud container (not a hosting service):

| Fact | Verified how |
|---|---|
| Node 22.22, npm 10.9, Postgres 16.15 (local cluster), Chromium 141 with Playwright | `node -v`, `pg_lsclusters`, `/opt/pw-browsers/chromium --version` |
| Outbound HTTPS to `api.openai.com` (401 without a key), `api.vercel.com` (403 "missing token") and `api.supabase.com` (401) all reachable | `curl -sS -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models` |
| Docker client present, daemon **not** usable → local Postgres used instead of Compose | `docker info` |
| **No public or invite-only URL can be served from this container.** It has no inbound routing. | Environment documentation for the cloud session |
| `OPENAI_API_KEY`, `DATABASE_URL` (Supabase), `VERCEL_TOKEN` were **not present** during the build session | `env` check |

Conclusion: the container cannot host a shareable preview. A working **local
preview** was built and verified instead (below), and the smallest external
deployment path is documented and ready to execute once credentials are present.

## Local preview (verified)

```bash
cp .env.example .env.local            # set DATABASE_URL; OPENAI_API_KEY optional
docker compose up -d                   # or any Postgres 15+
npm install
npm run db:migrate && npm run db:seed
npm run dev                            # http://localhost:3000
```

- Without `OPENAI_API_KEY`: **demo mode** only (simulated conversation, labeled).
- With `OPENAI_API_KEY`: accounts you create run in **live mode**; demo profiles stay simulated.
- Microphone access requires `localhost` or HTTPS (secure context).

**Verified 2026-10-23** in the build container: the exact steps above (with the
container's local Postgres instead of Docker) produced a working app on
http://127.0.0.1:3100 (`next build` + `next start`), the health endpoint returned
`{"ok":true,"db":"ok","liveConfigured":false}`, and the Playwright suite drove the demo
end to end with a fake microphone: 17 passed, 2 skipped (live). Full table in
`docs/TEST_PLAN.md` → "Latest results". Screenshots in `docs/screenshots/`.

## Smallest external deployment path (Vercel + Supabase)

The user has Vercel and Supabase accounts and is creating the Supabase project and
Vercel project themselves. Nothing has been deployed by this build; no infrastructure
charges have been incurred. To deploy:

1. **Supabase**: create a project → Connect → copy the **Session pooler** URI
   (port 5432, IPv4-compatible) as `DATABASE_URL`. Run migrations from your
   machine: `DATABASE_URL=… npm run db:migrate && npm run db:seed`.
2. **Vercel**: `npm i -g vercel && vercel login` (or set `VERCEL_TOKEN`), then in
   the repo: `vercel link`, then set environment variables for Production:
   `vercel env add OPENAI_API_KEY`, `vercel env add DATABASE_URL`,
   `vercel env add AUTH_SECRET` (use `openssl rand -base64 32`),
   `vercel env add COMPANION_ENABLE_DEMO_PROFILES` (`true` for a demo, `false` for real use),
   optional caps from `.env.example`. Deploy with `vercel --prod`.
3. Vercel serves HTTPS, so the microphone works. WebRTC audio goes browser → OpenAI
   directly; Vercel only serves the app and the `/api/*` routes. Set the Vercel
   function region near your users; Supabase pooler handles serverless connection churn.
4. Run `npm run verify` locally with the same env to confirm key, models and a
   client-secret mint before sharing the URL.

Automated deploy from the cloud session: `scripts/deploy-vercel.sh` performs steps 1–4 (migrate, seed, verify, set env, deploy). When `VERCEL_TOKEN`, `DATABASE_URL` and
`OPENAI_API_KEY` are present in the environment, the steps above can be executed by
Claude in a new session on this branch. **Status: not executed** (credentials were
not available during the build).

## Live acceptance script (manual, ~5 minutes, a few cents)

1. Open `/`, create an account, choose Ethel or Fred, land on `/talk`.
2. Press **Start talking**; allow the microphone. The orb should move to connecting
   then idle; the companion greets you by introducing itself and asks what to call you.
3. Say your name slowly with a pause in the middle ("My name is… Paul"). Expect one
   turn, not two (patient pause sensitivity).
4. While it is answering, start talking over it. It should stop within a second.
5. Say "Remember that I love gardening." Expect it to ask if you'd like it to remember
   things between chats (first time) → say yes → the consent card appears / memory toast.
6. End the conversation. Start a new one. Ask "What do you remember about me?"
7. Say "Less joking." Expect acknowledgement and a more sober tone. Say something
   serious ("My brother is in the hospital"). Expect warmth, no humor.
8. State a falsehood ("The Great Wall is visible from space, right?"). Expect a
   gentle correction, not agreement.
9. Switch model (Full ↔ Lower cost) mid-conversation; it should pick up the thread.
10. Open `/developer`: usage, estimated cost, and the pricing version are visible.
