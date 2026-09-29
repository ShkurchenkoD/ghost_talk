CREATE TABLE IF NOT EXISTS transcript_segments (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    participant_alias VARCHAR(80) NOT NULL,
    segment_key VARCHAR(80) NOT NULL DEFAULT '',
    track_sid VARCHAR(128) NOT NULL DEFAULT '',
    started_at_ms BIGINT NOT NULL,
    ended_at_ms BIGINT NOT NULL,
    text TEXT NOT NULL,
    language VARCHAR(20) NOT NULL DEFAULT '',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_final BOOLEAN NOT NULL DEFAULT TRUE,
    redacted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ended_at_ms >= started_at_ms)
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_time ON transcript_segments(session_id, started_at_ms, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_segments_idempotency
    ON transcript_segments(session_id, participant_id, segment_key)
    WHERE segment_key <> '';

-- participant IDs are global implementation details. Keep existing generated
-- aliases session-scoped as well, so a transcript cannot correlate a speaker
-- across meetings by its ordinal-looking database ID.
UPDATE transcript_segments ts
SET participant_alias = CONCAT('Participant ', (
    SELECT COUNT(*) FROM participants p
    WHERE p.session_id = ts.session_id AND p.id <= ts.participant_id
))
WHERE ts.participant_alias ~ '^Participant [0-9]+$';

CREATE TABLE IF NOT EXISTS participant_transcript_consents (
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS session_analysis_jobs (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    requested_by_role VARCHAR(40) NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_session_analysis_jobs_status_created ON session_analysis_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS session_insights (
    session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    executive_summary TEXT NOT NULL DEFAULT '',
    themes JSONB NOT NULL DEFAULT '[]'::jsonb,
    decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
    risks_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_items (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    owner_alias VARCHAR(80) NOT NULL DEFAULT '',
    due_date DATE,
    source_segment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_items_session ON action_items(session_id, id);
