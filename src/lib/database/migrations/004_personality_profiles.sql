-- Conversation-style ("personality") profile of the USER plus per-turn tone
-- observations ("three-channel listening": what / how / why).
--
-- Everything here is INFERRED. In live mode the Realtime model hears the voice
-- and reports what it noticed through the observe_tone tool; in demo mode, and
-- for the style profile in every mode, the inference comes from the WORDS of
-- the transcript only (laughter markers, exclamation density, question rate,
-- sentence length, warmth/humor vocabulary) — never from audio analysis. Both
-- tables are covered by memory consent, are shown to the user, can be reset
-- from the memory page, and go with the account (ON DELETE CASCADE).

CREATE TABLE personality_profiles (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  traits                 jsonb NOT NULL DEFAULT '{}'::jsonb,   -- StyleProfileTraits (src/lib/types.ts)
  summary                text,                                 -- one-paragraph model summary, when available
  evidence_conversations integer NOT NULL DEFAULT 0,
  evidence_messages      integer NOT NULL DEFAULT 0,
  source                 text NOT NULL DEFAULT 'heuristic' CHECK (source IN ('heuristic','model','mixed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER personality_profiles_updated_at BEFORE UPDATE ON personality_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per notable observation of HOW (tone) and WHY (intent) the user said
-- something. `cue` is a short quote or the matched words; it is never shown in
-- the UI (internal evidence) and is bounded to 200 characters.
CREATE TABLE tone_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  tone            text NOT NULL,
  intensity       real NOT NULL CHECK (intensity BETWEEN 0 AND 1),
  intent          text,
  cue             text CHECK (cue IS NULL OR char_length(cue) <= 200),
  source          text NOT NULL CHECK (source IN ('model','heuristic')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tone_events_user_created_idx ON tone_events(user_id, created_at DESC);
CREATE INDEX tone_events_conversation_idx ON tone_events(conversation_id);
