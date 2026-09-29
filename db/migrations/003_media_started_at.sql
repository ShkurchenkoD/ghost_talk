-- Transcript timestamps are relative to the first issued LiveKit token, not
-- to session creation (which may be hours or days earlier).
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS media_started_at TIMESTAMPTZ;
