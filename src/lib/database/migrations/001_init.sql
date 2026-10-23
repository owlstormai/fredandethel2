-- Companion — initial schema.
-- Every user-owned table carries user_id; every query MUST filter by it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE,                 -- NULL for demo profiles
  password_hash text,                          -- NULL for demo profiles
  is_demo       boolean NOT NULL DEFAULT false,
  demo_slug     text UNIQUE,                   -- e.g. 'margaret', 'walter'
  token_version integer NOT NULL DEFAULT 1,    -- bump to revoke all sessions
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT users_identity_chk CHECK (is_demo OR email IS NOT NULL)
);

CREATE TABLE profiles (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_name   text,
  companion_voice  text NOT NULL DEFAULT 'ethel' CHECK (companion_voice IN ('fred','ethel')),
  onboarding_stage text NOT NULL DEFAULT 'new'
                   CHECK (onboarding_stage IN ('new','named','interests','memory_decided','complete')),
  timezone         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preferences (
  user_id                   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  humor_level               text NOT NULL DEFAULT 'gentle' CHECK (humor_level IN ('off','gentle','playful')),
  orb_color                 text NOT NULL DEFAULT 'cyan' CHECK (orb_color IN ('cyan','violet','emerald','amber','white')),
  text_scale                text NOT NULL DEFAULT 'large' CHECK (text_scale IN ('normal','large','xlarge')),
  motion                    text NOT NULL DEFAULT 'system' CHECK (motion IN ('system','reduced','full')),
  captions                  boolean NOT NULL DEFAULT true,
  pause_sensitivity         text NOT NULL DEFAULT 'patient' CHECK (pause_sensitivity IN ('patient','balanced','quick')),
  model_key                 text NOT NULL DEFAULT 'full' CHECK (model_key IN ('full','mini')),
  memory_enabled            boolean NOT NULL DEFAULT false,
  sensitive_memory_enabled  boolean NOT NULL DEFAULT false,
  search_enabled            boolean NOT NULL DEFAULT false,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      text NOT NULL CHECK (scope IN ('memory','sensitive_memory','web_search','transcripts')),
  granted    boolean NOT NULL,
  source     text NOT NULL CHECK (source IN ('ui','voice','seed')),
  evidence   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_records_user_scope_idx ON consent_records(user_id, scope, created_at DESC);

CREATE TABLE model_configs (
  key             text PRIMARY KEY CHECK (key IN ('full','mini')),
  provider        text NOT NULL DEFAULT 'openai',
  model_id        text NOT NULL,
  label           text NOT NULL,
  tier            text NOT NULL CHECK (tier IN ('full','mini')),
  enabled         boolean NOT NULL DEFAULT true,
  pricing         jsonb NOT NULL,              -- USD per 1M tokens, see docs/COST_MODEL.md
  pricing_version text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode                      text NOT NULL CHECK (mode IN ('demo','live')),
  model_key                 text NOT NULL CHECK (model_key IN ('full','mini')),
  model_id                  text NOT NULL,
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','failed')),
  started_at                timestamptz NOT NULL DEFAULT now(),
  ended_at                  timestamptz,
  connected_seconds         numeric(10,2) NOT NULL DEFAULT 0,
  user_speech_seconds       numeric(10,2) NOT NULL DEFAULT 0,
  assistant_speech_seconds  numeric(10,2) NOT NULL DEFAULT 0,
  continued_from_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  summary_memory_id         uuid,                 -- FK added after memories exists
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX conversations_user_started_idx ON conversations(user_id, started_at DESC);

CREATE TABLE conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  role            text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content         text NOT NULL,
  item_id         text,
  tool_name       text,
  tool_payload    jsonb,
  sources         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);
CREATE INDEX conversation_messages_conv_idx ON conversation_messages(conversation_id, seq);
CREATE UNIQUE INDEX conversation_messages_item_idx ON conversation_messages(conversation_id, item_id) WHERE item_id IS NOT NULL;

CREATE TABLE memories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                    text NOT NULL CHECK (kind IN ('fact','preference','interest','relationship','story','summary')),
  category                text NOT NULL DEFAULT 'other'
                          CHECK (category IN ('identity','family','friends','interest','routine','preference','story','health','finances','grief','other')),
  content                 text NOT NULL,
  normalized              text NOT NULL,       -- lowercased, punctuation-stripped, for matching
  status                  text NOT NULL CHECK (status IN ('confirmed','reported','summarized','inferred')),
  sensitivity             text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  importance              smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source_conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id       uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
  last_referenced_at      timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX memories_user_live_idx ON memories(user_id, kind, status) WHERE deleted_at IS NULL;
CREATE INDEX memories_user_created_idx ON memories(user_id, created_at DESC);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_summary_fk FOREIGN KEY (summary_memory_id)
  REFERENCES memories(id) ON DELETE SET NULL;

-- Deleted facts must never be restored from summaries or re-extracted later.
CREATE TABLE memory_tombstones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  normalized text NOT NULL,
  keywords   text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_tombstones_user_idx ON memory_tombstones(user_id);

CREATE TABLE memory_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_id  uuid REFERENCES memories(id) ON DELETE SET NULL,
  event      text NOT NULL CHECK (event IN ('created','corrected','confirmed','deleted','recalled','suppressed','rejected')),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_events_user_idx ON memory_events(user_id, created_at DESC);

CREATE TABLE usage_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id      uuid REFERENCES conversations(id) ON DELETE SET NULL,
  model_id             text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('realtime_response','web_search','summary','transcription','session')),
  input_text_tokens    integer NOT NULL DEFAULT 0,
  input_audio_tokens   integer NOT NULL DEFAULT 0,
  cached_text_tokens   integer NOT NULL DEFAULT 0,
  cached_audio_tokens  integer NOT NULL DEFAULT 0,
  output_text_tokens   integer NOT NULL DEFAULT 0,
  output_audio_tokens  integer NOT NULL DEFAULT 0,
  search_calls         integer NOT NULL DEFAULT 0,
  duration_seconds     numeric(10,2) NOT NULL DEFAULT 0,
  estimated_cost_usd   numeric(12,6) NOT NULL DEFAULT 0,
  pricing_version      text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX usage_events_user_created_idx ON usage_events(user_id, created_at DESC);
CREATE INDEX usage_events_created_idx ON usage_events(created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER preferences_updated_at BEFORE UPDATE ON preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
