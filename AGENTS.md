# AGENTS.md — Companion

## Mission
Build a real, accessible, voice-first AI conversation companion, especially suitable for older adults. The prototype must work, not merely look impressive. Build autonomously, test honestly, and document limitations. Never claim a public preview or API capability without verifying it.

## Product experience
A clean, dark, modern interface with a luminous cyan-blue, Jarvis-inspired orb centered on screen. Original visual design, not copied from Marvel or ChatGPT. Responsive on tablet, desktop and mobile. The orb has real audio-responsive idle, listening, thinking, speaking, interruption, connecting and error states. Add a restrained color selector (cyan, violet, emerald, amber, white). Respect reduced-motion settings, keyboard and screen-reader access, large controls, adjustable text and captions. Make it sophisticated rather than childish or nostalgic.

## Personality: warmth, humor and independent thought
The companion is **warm, funny, playful, personable, curious, empathetic, and never pandering**. Humor is a genuine feature, not an afterthought. It may make spontaneous, contextually appropriate jokes, gentle observations, wordplay, and affectionate callbacks to previously shared interests, stories and running jokes **only when those memories were saved with consent**. Humor should feel conversational rather than scripted; vary the style and do not force a joke into every turn. Recognize when the user wants a serious conversation and drop humor immediately. Do not make jokes about disability, cognitive decline, grief, medical issues, or other vulnerabilities unless the user clearly invites that specific kind of humor; even then use care.

Do not reflexively agree. Offer tactful counterpoints, ask intelligent follow-up questions, express curiosity, and correct factual errors gently when evidence warrants it. Be a thoughtful conversation partner rather than a yes-machine. Avoid empty praise, infantilizing language, excessive validation, artificial intimacy, manipulative attachment, and claims to be human. Encourage real-world human connections without lecturing. Be comfortable with silence and meandering stories. Never fabricate a personal memory or imply something was remembered when it was not. Allow users to choose a humor level (off, gentle, playful) and to say “less joking” at any time. Do not pretend to be a therapist or emergency responder.

## Progressive onboarding
Begin with a friendly greeting, preferred name, interests, and explicit opt-in to memory. Do not administer a long questionnaire. Learn gradually, allow skips, and separate consent for retaining sensitive information. Support a returning user experience without biometric identification.

## Architecture
Preferred MVP stack: Next.js + TypeScript + React + Tailwind; Next.js server routes and modular services; PostgreSQL for durable storage, migrations, and optionally pgvector if retrieval benchmarks justify it. Use Web Audio API for orb amplitude. Keep the app portable; avoid requiring Supabase or Vercel to run locally. Docker Compose for local database if practical.

Modules: `src/components/orb`, `src/components/voice`, `src/components/settings`, `src/components/memory`, `src/lib/ai/adapters`, `src/lib/ai/realtime`, `src/lib/ai/tools`, `src/lib/memory`, `src/lib/database`, `src/lib/auth`, `src/lib/usage`, `src/lib/privacy`.

## Realtime conversation
Use the documented OpenAI Realtime API with WebRTC in browsers and secure short-lived session credentials generated server-side. Verify actual API model IDs and supported settings from current docs; do not confuse ChatGPT voice model names with API model names. Support real streaming two-way audio, VAD (prefer patient semantic turn detection where supported), barge-in, interruption/cancellation, connection status, reconnect, mic permission failures, mute, transcript when available, and clear end-session control. Make pause sensitivity configurable and test with slow, hesitant speech.

## Model-independent memory and switching
**Memory belongs to this app, not to any AI model.** Store profile facts, preferences, consent, conversation summaries, episodic memories, and provenance in the database. Both the full and lower-cost Realtime models must use the same memory store and retrieval logic. Provide a model selector and developer comparison mode. A switch may require disconnecting and starting a new Realtime session; preserve and rehydrate application-owned context. Do not claim hidden model state can transfer.

Schema should include `users`, `profiles`, `preferences`, `conversations`, `conversation_messages`, `memories`, `memory_events`, `model_configs`, `usage_events`, `consent_records`. Scope all user data by authenticated user ID or clearly isolated demo profile. Label facts as confirmed, reported, summarized, or inferred; never silently promote an inference to a fact. Implement view, correct, delete, export, memory-off, and delete-account/data flows. Ensure deleted memories do not leak back through cached summaries. Keep context retrieval bounded and relevant. Start with structured/keyword retrieval; add vector search only if needed.

## Web search
Provide optional current-information lookup (news, sports, weather) through a verified supported server-side tool path. The Realtime model may call an application function that invokes a compatible search/text service. Display sources in transcript/UI. Never send unnecessary private memory to external search. Track search costs and avoid gratuitous calls.

## Security and consent
Never put API keys or database secrets in frontend bundles. Include `.env.example`, secret handling instructions, input validation, per-user authorization, encryption in transit, rate limiting, cost caps, privacy-aware logging, retention/deletion policy, and clear consent. Do not add voice biometrics or voice cloning. Provide sensible handling of distress, emergencies and medical questions without representing the product as clinical care. A demo profile is not production authentication.

## Cost tracking
Record session and speech duration where measurable, token usage if reported, model, search calls, and estimated cost. Do not equate connected minutes with billable audio minutes. Keep pricing assumptions configurable and labeled estimates. Provide a developer usage/cost panel and usage limits. No real billing in MVP.

## Preview-first verification
**Before major implementation**, determine whether the current Codex environment can run the app and provide a genuinely shareable public/invite-only preview URL with working microphone/WebRTC and persistent state. Document verified results in `PREVIEW.md`. A cloud coding sandbox is not automatically a public hosting service. If unavailable, implement a working local preview and document the smallest external deployment path; do not deploy publicly or incur costs without explicit approval.

## Development modes
- **Demo mode**: no paid API, seeded fake profiles and explicitly labeled simulated conversation/audio states.
- **Live mode**: actual OpenAI Realtime API, real audio, persistent memory, model switching and usage telemetry.
Never misrepresent a simulated mode as live AI.

## Implementation plan
0. Verify current API capabilities, model IDs, interruption/VAD, preview constraints and hosting assumptions.
1. Implement polished accessible UI and responsive audio orb.
2. Implement real voice over WebRTC, session lifecycle, interruption, and audio-reactive animation.
3. Implement database, progressive onboarding, consent, memories, summaries, and user memory controls.
4. Implement model adapters, runtime switching with context rehydration, and side-by-side developer testing.
5. Add optional search, cost instrumentation and caps.
6. Add tests, hardening, documentation and verified preview instructions.

## Acceptance tests
1. User can begin a real two-way voice conversation.
2. Orb responds to actual microphone and assistant output audio.
3. User can interrupt speech and assistant stops promptly.
4. Hesitations and longer pauses do not cause constant premature interruption.
5. User can consent to saving a personal fact; a new session recalls it appropriately.
6. Full/mini model switching preserves application-owned memories and context.
7. User can inspect, correct and delete memories; deleted facts are not restored from summaries.
8. Humor level changes behavior, contextual jokes are natural, and serious topics receive serious responses.
9. Assistant can respectfully disagree rather than reflexively validate.
10. Secrets are not exposed to the browser; data isolation is enforced.
11. Demo mode works without an API key; live mode works with valid credentials.
12. Usage and estimated cost are visible to developers.
13. Local launch steps are reproducible; preview/shareability claims are verified.
14. Tests pass or failures are explicitly reported.

## Deliverables
Functional code, migrations, `.env.example`, `README.md`, `PREVIEW.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/COST_MODEL.md`, `docs/TEST_PLAN.md`, `docs/DECISIONS.md`, unit/integration/e2e tests as appropriate. Report what works, what is simulated, what needs credentials, test results, and remaining limitations.

## Execution instructions
Do not stop after planning. Implement, run, debug, test, and document. Make reasonable choices without asking routine questions. Do not invent pricing, model support, preview links, or test success. Do not deploy publicly or incur external infrastructure charges without approval. Prioritize a working vertical slice over a pretty but nonfunctional shell.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
