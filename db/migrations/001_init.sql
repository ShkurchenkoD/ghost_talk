CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(8) NOT NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    methodology VARCHAR(40) NOT NULL,
    video_room VARCHAR(160) NOT NULL,
    facilitator_token VARCHAR(64) NOT NULL UNIQUE,
    voting_open BOOLEAN NOT NULL DEFAULT TRUE,
    ended_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS video_room VARCHAR(160);

UPDATE sessions
SET video_room = CONCAT('ghosttalk-', LOWER(code))
WHERE video_room IS NULL OR video_room = '';

ALTER TABLE sessions
    ALTER COLUMN video_room SET NOT NULL;

CREATE TABLE IF NOT EXISTS participants (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category VARCHAR(40) NOT NULL,
    vote_count INT NOT NULL DEFAULT 0,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votes (
    id BIGSERIAL PRIMARY KEY,
    card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(card_id, participant_id)
);

CREATE TABLE IF NOT EXISTS summaries (
    session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    markdown TEXT NOT NULL DEFAULT '',
    grouped_thoughts TEXT NOT NULL DEFAULT '',
    risks_questions TEXT NOT NULL DEFAULT '',
    action_items TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS join_secret VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS max_participants INT NOT NULL DEFAULT 100;

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS facilitator_token_expires_at TIMESTAMPTZ;

UPDATE sessions
SET facilitator_token_expires_at = COALESCE(facilitator_token_expires_at, created_at + INTERVAL '30 days');

ALTER TABLE sessions
    ALTER COLUMN facilitator_token_expires_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    actor_role VARCHAR(40) NOT NULL DEFAULT '',
    actor_token VARCHAR(64) NOT NULL DEFAULT '',
    client_ip VARCHAR(80) NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voice_templates (
    id VARCHAR(120) PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    provider VARCHAR(50) NOT NULL,
    voice_id VARCHAR(255) NOT NULL,
    language VARCHAR(20),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participant_anonymous_audio (
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    audio_mode VARCHAR(20) NOT NULL DEFAULT 'normal',
    language_mode VARCHAR(20) NOT NULL DEFAULT 'auto',
    preferred_language VARCHAR(20) NOT NULL DEFAULT 'uk-UA',
    voice_template_id VARCHAR(120) NOT NULL DEFAULT 'anonymous-neutral-01' REFERENCES voice_templates(id),
    pii_redaction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    fallback_mode VARCHAR(20) NOT NULL DEFAULT 'mute',
    status VARCHAR(20) NOT NULL DEFAULT 'off',
    worker_ready BOOLEAN NOT NULL DEFAULT FALSE,
    worker_connected BOOLEAN NOT NULL DEFAULT FALSE,
    detected_language VARCHAR(20) NOT NULL DEFAULT '',
    language_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    latency_ms INT NOT NULL DEFAULT 0,
    last_error_code VARCHAR(80) NOT NULL DEFAULT '',
    last_error_message TEXT NOT NULL DEFAULT '',
    language_locked BOOLEAN NOT NULL DEFAULT FALSE,
    last_transition_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, participant_id)
);

INSERT INTO voice_templates (id, slug, name, description, provider, voice_id)
VALUES
    ('anonymous-neutral-01', 'anonymous-neutral-01', 'Neutral Anonymous', 'Neutral synthetic anonymous voice', 'piper', 'uk_UA-lada-x_low'),
    ('anonymous-deep-01', 'anonymous-deep-01', 'Deep Anonymous', 'Lower synthetic anonymous voice', 'piper', 'en_GB-alan-low'),
    ('anonymous-light-01', 'anonymous-light-01', 'Light Anonymous', 'Lighter synthetic anonymous voice', 'piper', 'en_US-amy-medium'),
    ('anonymous-robot-01', 'anonymous-robot-01', 'Synthetic Robot', 'Synthetic robotic anonymous voice', 'piper', 'en_US-lessac-medium')
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    provider = EXCLUDED.provider,
    voice_id = EXCLUDED.voice_id,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_cards_session ON cards(session_id);
CREATE INDEX IF NOT EXISTS idx_votes_card ON votes(card_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_created ON audit_events(session_id, created_at DESC);
