# Cost model

All figures are **estimates** computed from configurable per-token prices. They are
shown to developers in the usage panel (`/developer`) and are never presented as a
bill. Pricing version: `2026-10-22` (see `PRICING_VERSION` in `src/lib/ai/models.ts`).
Prices were read from the OpenAI pricing page on that date; see
`docs/API_VERIFICATION.md` §7 for the verbatim rows.

## What is billed (and what is not)

- **Connected minutes are not billable minutes.** The Realtime API bills tokens,
  not wall-clock time. A patient listener who talks for two minutes in a
  ten-minute session pays for roughly two minutes of input audio tokens plus the
  assistant's output audio, plus the text context re-sent each turn.
- Audio token rates documented by OpenAI: **1 input token per 100 ms** of user
  audio, **1 output token per 50 ms** of assistant audio.
- Each assistant response reports `usage` in `response.done`. Companion records
  that per response (`usage_events.kind = realtime_response`).
- Transcription of the user's audio (`gpt-realtime-whisper`) is billed per minute
  of input audio.
- Web search is billed per tool call plus the text model's tokens.
- Summaries after a conversation use a small text model.

## Prices used (USD per 1M tokens unless noted)

| Model | Text in | Cached text in | Text out | Audio in | Cached audio in | Audio out |
|---|---|---|---|---|---|---|
| `gpt-realtime-2.1` (Full quality) | 4.00 | 0.40 | 24.00 | 32.00 | 0.40 | 64.00 |
| `gpt-realtime-2.1-mini` (Lower cost) | 0.60 | 0.06 | 2.40 | 10.00 | 0.30 | 20.00 |
| `gpt-6-luna` (search + summaries) | 0.10 | 0.01 | 0.50 | — | — | — |

| Item | Price |
|---|---|
| `gpt-realtime-whisper` input transcription | $0.017 per minute |
| `web_search` tool call | $10.00 per 1,000 calls (+ model tokens) |

## Formulas

```
realtime_cost = (input_text − cached_text)  × textInput
              + cached_text                 × textCachedInput
              + (input_audio − cached_audio)× audioInput
              + cached_audio                × audioCachedInput
              + output_text                 × textOutput
              + output_audio                × audioOutput
              (all token counts ÷ 1,000,000)

transcription_cost = seconds_of_user_audio / 60 × 0.017
search_cost        = calls × 0.01 + text tokens at the text model's rates
```

Cached tokens are priced at the cached rate only; they are **not** also charged
at the full input rate.

## Worked example (Full quality)

One minute of user speech (600 input audio tokens) and one minute of assistant
speech (1,200 output audio tokens), ignoring text context:

```
600   / 1e6 × 32 = $0.0192
1,200 / 1e6 × 64 = $0.0768
total             ≈ $0.096 per spoken minute pair
```

The same minute on `gpt-realtime-2.1-mini` is about $0.030. Text context (the
instructions plus memory block, a few thousand tokens re-sent each turn) adds a
few cents per turn on Full and well under a cent on mini; OpenAI's automatic
prompt caching reduces this substantially when the session history stays static.

## Caps

Environment variables (see `.env.example`):

| Variable | Default | Effect |
|---|---|---|
| `COMPANION_DAILY_COST_CAP_USD` | 5 | New live sessions refused when today's estimated spend across all users exceeds this |
| `COMPANION_PER_USER_DAILY_COST_CAP_USD` | 2 | Same, per user |
| `COMPANION_MAX_SESSION_MINUTES` | 30 | Client ends the session at this limit (API hard limit is 60) |

Caps are enforced server-side when a session is minted (`/api/realtime/session`)
and read from `usage_events`. A running session is not cut off by a cap; the
next one is refused.

## Known gaps

- Costs are computed from token counts the API reports; if a response ends
  without `response.done` (network drop) its usage is lost and the estimate is low.
- Demo mode records durations only; its cost is always $0.
- No real billing exists in the MVP.
