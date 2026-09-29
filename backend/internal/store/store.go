package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"ghosttalk/backend/internal/model"
)

var ErrNotFound = errors.New("not found")
var ErrDuplicateVote = errors.New("duplicate vote")

type Store struct {
	db             *sql.DB
	facilitatorTTL time.Duration
	participantTTL time.Duration
}

func New(dsn string, facilitatorTTL, participantTTL time.Duration) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(15)
	db.SetMaxIdleConns(15)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	st := &Store{db: db, facilitatorTTL: facilitatorTTL, participantTTL: participantTTL}
	if err := st.ensureSchema(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return st, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) ensureSchema(ctx context.Context) error {
	statements := []string{
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS media_started_at TIMESTAMPTZ`,
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS video_room VARCHAR(160)`,
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS join_secret VARCHAR(64) NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_participants INT NOT NULL DEFAULT 100`,
		`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS facilitator_token_expires_at TIMESTAMPTZ`,
		`UPDATE sessions SET video_room = CONCAT('ghosttalk-', LOWER(code)) WHERE video_room IS NULL OR video_room = ''`,
		`UPDATE sessions SET facilitator_token_expires_at = COALESCE(facilitator_token_expires_at, created_at + INTERVAL '30 days')`,
		`ALTER TABLE sessions ALTER COLUMN video_room SET NOT NULL`,
		`ALTER TABLE sessions ALTER COLUMN facilitator_token_expires_at SET NOT NULL`,
		`ALTER TABLE participants ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
		`UPDATE participants SET expires_at = COALESCE(expires_at, created_at + INTERVAL '7 days')`,
		`ALTER TABLE participants ALTER COLUMN expires_at SET NOT NULL`,
		`CREATE TABLE IF NOT EXISTS audit_events (
			id BIGSERIAL PRIMARY KEY,
			session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			event_type VARCHAR(80) NOT NULL,
			actor_role VARCHAR(40) NOT NULL DEFAULT '',
			actor_token VARCHAR(64) NOT NULL DEFAULT '',
			client_ip VARCHAR(80) NOT NULL DEFAULT '',
			user_agent TEXT NOT NULL DEFAULT '',
			details JSONB NOT NULL DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_events_session_created ON audit_events(session_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS voice_templates (
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
		)`,
		`CREATE TABLE IF NOT EXISTS participant_anonymous_audio (
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
		)`,
		`CREATE TABLE IF NOT EXISTS transcript_segments (
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
		)`,
		`ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS segment_key VARCHAR(80) NOT NULL DEFAULT ''`,
		`CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_time ON transcript_segments(session_id, started_at_ms, id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_segments_idempotency ON transcript_segments(session_id, participant_id, segment_key) WHERE segment_key <> ''`,
		// Repair aliases produced by the first implementation, which used the
		// globally stable participants.id. Only generated aliases are touched;
		// a future explicitly assigned session alias remains intact.
		`UPDATE transcript_segments ts
		 SET participant_alias = CONCAT('Participant ', (
			 SELECT COUNT(*) FROM participants p
			 WHERE p.session_id = ts.session_id AND p.id <= ts.participant_id
		 ))
		 WHERE ts.participant_alias ~ '^Participant [0-9]+$'`,
		`CREATE TABLE IF NOT EXISTS participant_transcript_consents (
			session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			participant_id BIGINT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
			consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			revoked_at TIMESTAMPTZ,
			PRIMARY KEY (session_id, participant_id)
		)`,
		`CREATE TABLE IF NOT EXISTS session_analysis_jobs (
			id BIGSERIAL PRIMARY KEY,
			session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			status VARCHAR(24) NOT NULL DEFAULT 'queued',
			requested_by_role VARCHAR(40) NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			started_at TIMESTAMPTZ,
			finished_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_session_analysis_jobs_status_created ON session_analysis_jobs(status, created_at)`,
		`CREATE TABLE IF NOT EXISTS session_insights (
			session_id BIGINT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
			executive_summary TEXT NOT NULL DEFAULT '',
			themes JSONB NOT NULL DEFAULT '[]'::jsonb,
			decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
			risks_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
			generated_at TIMESTAMPTZ,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS action_items (
			id BIGSERIAL PRIMARY KEY,
			session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			text TEXT NOT NULL,
			owner_alias VARCHAR(80) NOT NULL DEFAULT '',
			due_date DATE,
			source_segment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
			status VARCHAR(24) NOT NULL DEFAULT 'open',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_action_items_session ON action_items(session_id, id)`,
	}
	for _, stmt := range statements {
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			return err
		}
	}
	if err := s.seedVoiceTemplates(ctx); err != nil {
		return err
	}
	return nil
}

func (s *Store) seedVoiceTemplates(ctx context.Context) error {
	seed := []struct {
		id, slug, name, description, provider, voiceID string
	}{
		{"anonymous-neutral-01", "anonymous-neutral-01", "Neutral Anonymous", "Neutral synthetic anonymous voice", "piper", "uk_UA-lada-x_low"},
		{"anonymous-deep-01", "anonymous-deep-01", "Deep Anonymous", "Lower synthetic anonymous voice", "piper", "en_GB-alan-low"},
		{"anonymous-light-01", "anonymous-light-01", "Light Anonymous", "Lighter synthetic anonymous voice", "piper", "en_US-amy-medium"},
		{"anonymous-robot-01", "anonymous-robot-01", "Synthetic Robot", "Synthetic robotic anonymous voice", "piper", "en_US-lessac-medium"},
	}
	for _, item := range seed {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO voice_templates (id, slug, name, description, provider, voice_id)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (id) DO UPDATE
			SET slug = EXCLUDED.slug,
			    name = EXCLUDED.name,
			    description = EXCLUDED.description,
			    provider = EXCLUDED.provider,
			    voice_id = EXCLUDED.voice_id,
			    updated_at = NOW()
		`, item.id, item.slug, item.name, item.description, item.provider, item.voiceID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AppendAuditEvent(ctx context.Context, sessionID int64, eventType, actorRole, actorToken, clientIP, userAgent string, details map[string]interface{}) error {
	if details == nil {
		details = map[string]interface{}{}
	}
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO audit_events (session_id, event_type, actor_role, actor_token, client_ip, user_agent, details)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
	`, sessionID, eventType, actorRole, actorToken, clientIP, userAgent, string(payload))
	return err
}

func (s *Store) ListAuditEvents(ctx context.Context, sessionCode string, limit int, beforeID int64) ([]model.AuditEvent, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, session_id, event_type, actor_role, actor_token, client_ip, user_agent, details::text, created_at
		FROM audit_events
		WHERE session_id = $1
	`
	args := []interface{}{session.ID}
	if beforeID > 0 {
		query += ` AND id < $2 ORDER BY id DESC LIMIT $3`
		args = append(args, beforeID, limit)
	} else {
		query += ` ORDER BY id DESC LIMIT $2`
		args = append(args, limit)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]model.AuditEvent, 0, limit)
	for rows.Next() {
		var e model.AuditEvent
		if err := rows.Scan(&e.ID, &e.SessionID, &e.EventType, &e.ActorRole, &e.ActorToken, &e.ClientIP, &e.UserAgent, &e.Details, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func (s *Store) CreateTranscriptSegment(ctx context.Context, sessionCode, participantToken string, in model.TranscriptSegment) (model.TranscriptSegment, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.TranscriptSegment{}, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.TranscriptSegment{}, err
	}
	if participant.SessionID != session.ID {
		return model.TranscriptSegment{}, ErrNotFound
	}
	var consented bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM participant_transcript_consents WHERE session_id = $1 AND participant_id = $2 AND revoked_at IS NULL)
	`, session.ID, participant.ID).Scan(&consented); err != nil {
		return model.TranscriptSegment{}, err
	}
	if !consented {
		return model.TranscriptSegment{}, ErrTranscriptConsentRequired
	}
	if in.ParticipantAlias == "" {
		// A database participant ID is global, so exposing it here would allow
		// someone who can read two transcripts to correlate a person across
		// sessions. The transcript contract requires a session-scoped alias.
		alias, aliasErr := s.transcriptParticipantAlias(ctx, session.ID, participant.ID)
		if aliasErr != nil {
			return model.TranscriptSegment{}, aliasErr
		}
		in.ParticipantAlias = alias
	}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO transcript_segments (
			session_id, participant_id, participant_alias, segment_key, track_sid, started_at_ms, ended_at_ms,
			text, language, confidence, is_final, redacted
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (session_id, participant_id, segment_key) WHERE segment_key <> ''
		DO UPDATE SET updated_at = transcript_segments.updated_at
		RETURNING id, session_id, participant_id, participant_alias, track_sid, started_at_ms, ended_at_ms,
			text, language, confidence, is_final, redacted, created_at, updated_at
	`, session.ID, participant.ID, in.ParticipantAlias, in.SegmentKey, in.TrackSID, in.StartedAtMs, in.EndedAtMs,
		in.Text, in.Language, in.Confidence, in.IsFinal, in.Redacted).Scan(
		&in.ID, &in.SessionID, &in.ParticipantID, &in.ParticipantAlias, &in.TrackSID, &in.StartedAtMs, &in.EndedAtMs,
		&in.Text, &in.Language, &in.Confidence, &in.IsFinal, &in.Redacted, &in.CreatedAt, &in.UpdatedAt,
	)
	return in, err
}

// transcriptParticipantAlias deliberately derives the display ordinal within
// one session. It must not use participant.ID directly: that identifier is
// stable across sessions and is therefore identifying metadata.
func (s *Store) transcriptParticipantAlias(ctx context.Context, sessionID, participantID int64) (string, error) {
	var ordinal int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM participants
		WHERE session_id = $1 AND id <= $2
	`, sessionID, participantID).Scan(&ordinal)
	if err != nil {
		return "", err
	}
	if ordinal < 1 {
		return "", ErrNotFound
	}
	return fmt.Sprintf("Participant %d", ordinal), nil
}

var ErrTranscriptConsentRequired = errors.New("transcript consent required")

func (s *Store) SetTranscriptConsent(ctx context.Context, sessionCode, participantToken string, consent bool) (bool, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return false, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return false, err
	}
	if participant.SessionID != session.ID {
		return false, ErrNotFound
	}
	if consent {
		_, err = s.db.ExecContext(ctx, `
			INSERT INTO participant_transcript_consents (session_id, participant_id, consented_at, revoked_at)
			VALUES ($1,$2,NOW(),NULL)
			ON CONFLICT (session_id, participant_id) DO UPDATE SET consented_at = NOW(), revoked_at = NULL
		`, session.ID, participant.ID)
	} else {
		_, err = s.db.ExecContext(ctx, `
			UPDATE participant_transcript_consents SET revoked_at = NOW() WHERE session_id = $1 AND participant_id = $2
		`, session.ID, participant.ID)
	}
	return consent, err
}

func (s *Store) HasTranscriptConsent(ctx context.Context, sessionCode, participantToken string) (bool, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return false, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return false, err
	}
	if participant.SessionID != session.ID {
		return false, ErrNotFound
	}
	var consented bool
	err = s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM participant_transcript_consents WHERE session_id = $1 AND participant_id = $2 AND revoked_at IS NULL)`, session.ID, participant.ID).Scan(&consented)
	return consented, err
}

// ConsentedTranscriptParticipant returns only the session-scoped pseudonym
// needed for transient captions. It deliberately does not expose a global
// participant identifier to callers outside the backend.
func (s *Store) ConsentedTranscriptParticipant(ctx context.Context, sessionCode, participantToken string) (int64, string, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return 0, "", err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return 0, "", err
	}
	if participant.SessionID != session.ID {
		return 0, "", ErrNotFound
	}
	var consented bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM participant_transcript_consents WHERE session_id = $1 AND participant_id = $2 AND revoked_at IS NULL)
	`, session.ID, participant.ID).Scan(&consented); err != nil {
		return 0, "", err
	}
	if !consented {
		return 0, "", ErrTranscriptConsentRequired
	}
	alias, err := s.transcriptParticipantAlias(ctx, session.ID, participant.ID)
	if err != nil {
		return 0, "", err
	}
	return participant.ID, alias, nil
}

// PurgeExpiredTranscriptArtifacts removes every transcript-derived artifact
// for ended sessions. Action items are included because their text and owner
// alias can still expose what was discussed in a retained meeting record.
func (s *Store) PurgeExpiredTranscriptArtifacts(ctx context.Context, retention time.Duration) (int64, error) {
	if retention <= 0 {
		return 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	cutoff := time.Now().Add(-retention)
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM session_insights
		WHERE session_id IN (SELECT id FROM sessions WHERE ended_at IS NOT NULL AND ended_at < $1)
	`, cutoff); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM action_items
		WHERE session_id IN (SELECT id FROM sessions WHERE ended_at IS NOT NULL AND ended_at < $1)
	`, cutoff); err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
		DELETE FROM transcript_segments
		WHERE session_id IN (SELECT id FROM sessions WHERE ended_at IS NOT NULL AND ended_at < $1)
	`, cutoff)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	count, _ := result.RowsAffected()
	return count, nil
}

func (s *Store) ListTranscriptSegments(ctx context.Context, sessionCode string, fromMs int64, limit int) ([]model.TranscriptSegment, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 5000 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, participant_id, participant_alias, track_sid, started_at_ms, ended_at_ms,
		       text, language, confidence, is_final, redacted, created_at, updated_at
		FROM transcript_segments
		WHERE session_id = $1 AND is_final = TRUE AND started_at_ms >= $2
		ORDER BY started_at_ms ASC, id ASC LIMIT $3
	`, session.ID, fromMs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.TranscriptSegment, 0, limit)
	for rows.Next() {
		var item model.TranscriptSegment
		if err := rows.Scan(&item.ID, &item.SessionID, &item.ParticipantID, &item.ParticipantAlias, &item.TrackSID,
			&item.StartedAtMs, &item.EndedAtMs, &item.Text, &item.Language, &item.Confidence, &item.IsFinal,
			&item.Redacted, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetTranscriptSegment(ctx context.Context, id int64) (model.TranscriptSegment, error) {
	var item model.TranscriptSegment
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, participant_id, participant_alias, track_sid, started_at_ms, ended_at_ms,
		       text, language, confidence, is_final, redacted, created_at, updated_at
		FROM transcript_segments WHERE id = $1 AND is_final = TRUE
	`, id).Scan(&item.ID, &item.SessionID, &item.ParticipantID, &item.ParticipantAlias, &item.TrackSID,
		&item.StartedAtMs, &item.EndedAtMs, &item.Text, &item.Language, &item.Confidence, &item.IsFinal,
		&item.Redacted, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) UpdateTranscriptSegment(ctx context.Context, id int64, text string, redacted bool) (model.TranscriptSegment, error) {
	result, err := s.db.ExecContext(ctx, `
		UPDATE transcript_segments SET text = $1, redacted = $2, updated_at = NOW()
		WHERE id = $3 AND is_final = TRUE
	`, text, redacted, id)
	if err != nil {
		return model.TranscriptSegment{}, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return model.TranscriptSegment{}, ErrNotFound
	}
	return s.GetTranscriptSegment(ctx, id)
}

func (s *Store) CreateAnalysisJob(ctx context.Context, sessionCode, role string) (model.AnalysisJob, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.AnalysisJob{}, err
	}
	var job model.AnalysisJob
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO session_analysis_jobs (session_id, requested_by_role)
		VALUES ($1,$2)
		RETURNING id, session_id, status, requested_by_role, error_message, created_at, started_at, finished_at
	`, session.ID, role).Scan(&job.ID, &job.SessionID, &job.Status, &job.RequestedByRole, &job.ErrorMessage,
		&job.CreatedAt, &job.StartedAt, &job.FinishedAt)
	return job, err
}

func (s *Store) GetSessionInsight(ctx context.Context, sessionCode string) (model.SessionInsight, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.SessionInsight{}, err
	}
	var insight model.SessionInsight
	err = s.db.QueryRowContext(ctx, `
		SELECT session_id, executive_summary, themes, decisions, risks_questions, generated_at, updated_at
		FROM session_insights WHERE session_id = $1
	`, session.ID).Scan(&insight.SessionID, &insight.ExecutiveSummary, &insight.Themes, &insight.Decisions,
		&insight.RisksQuestions, &insight.GeneratedAt, &insight.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return insight, ErrNotFound
	}
	return insight, err
}

func (s *Store) ListActionItems(ctx context.Context, sessionCode string) ([]model.ActionItem, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, text, owner_alias, due_date, source_segment_ids, status, created_at, updated_at
		FROM action_items WHERE session_id = $1 ORDER BY id ASC
	`, session.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.ActionItem, 0)
	for rows.Next() {
		var item model.ActionItem
		if err := rows.Scan(&item.ID, &item.SessionID, &item.Text, &item.OwnerAlias, &item.DueDate, &item.SourceSegmentIDs, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetActionItem(ctx context.Context, id int64) (model.ActionItem, error) {
	var item model.ActionItem
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, text, owner_alias, due_date, source_segment_ids, status, created_at, updated_at
		FROM action_items WHERE id = $1
	`, id).Scan(&item.ID, &item.SessionID, &item.Text, &item.OwnerAlias, &item.DueDate, &item.SourceSegmentIDs, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) UpdateActionItem(ctx context.Context, id int64, text, ownerAlias, status string, dueDate *time.Time) (model.ActionItem, error) {
	result, err := s.db.ExecContext(ctx, `
		UPDATE action_items SET text = $1, owner_alias = $2, status = $3, due_date = $4, updated_at = NOW() WHERE id = $5
	`, text, ownerAlias, status, dueDate, id)
	if err != nil {
		return model.ActionItem{}, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return model.ActionItem{}, ErrNotFound
	}
	return s.GetActionItem(ctx, id)
}

// ClaimNextAnalysisJob atomically assigns queued work. A running job whose
// worker lease has expired is eligible again so a worker crash cannot leave a
// facilitator's analysis permanently stuck in "running". The lease is well
// above the analysis worker's HTTP timeout.
func (s *Store) ClaimNextAnalysisJob(ctx context.Context) (model.AnalysisJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.AnalysisJob{}, err
	}
	defer tx.Rollback()
	var job model.AnalysisJob
	err = tx.QueryRowContext(ctx, `
		WITH next_job AS (
			SELECT id FROM session_analysis_jobs
			WHERE status = 'queued'
			   OR (status = 'running' AND started_at < NOW() - INTERVAL '15 minutes')
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE session_analysis_jobs j
		SET status = 'running', started_at = NOW(), error_message = ''
		FROM next_job
		WHERE j.id = next_job.id
		RETURNING j.id, j.session_id, j.status, j.requested_by_role, j.error_message, j.created_at, j.started_at, j.finished_at
	`).Scan(&job.ID, &job.SessionID, &job.Status, &job.RequestedByRole, &job.ErrorMessage, &job.CreatedAt, &job.StartedAt, &job.FinishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return job, ErrNotFound
	}
	if err != nil {
		return job, err
	}
	if err := tx.Commit(); err != nil {
		return model.AnalysisJob{}, err
	}
	return job, nil
}

func (s *Store) GetSessionCodeByAnalysisJobID(ctx context.Context, jobID int64) (string, error) {
	var code string
	err := s.db.QueryRowContext(ctx, `
		SELECT s.code FROM session_analysis_jobs j JOIN sessions s ON s.id = j.session_id WHERE j.id = $1
	`, jobID).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return code, err
}

func (s *Store) CompleteAnalysisJob(ctx context.Context, jobID int64, insight model.SessionInsight, actions []model.ActionItem) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var sessionID int64
	if err := tx.QueryRowContext(ctx, `SELECT session_id FROM session_analysis_jobs WHERE id = $1 AND status = 'running' FOR UPDATE`, jobID).Scan(&sessionID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO session_insights (session_id, executive_summary, themes, decisions, risks_questions, generated_at)
		VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,NOW())
		ON CONFLICT (session_id) DO UPDATE SET executive_summary = EXCLUDED.executive_summary, themes = EXCLUDED.themes,
		decisions = EXCLUDED.decisions, risks_questions = EXCLUDED.risks_questions, generated_at = NOW(), updated_at = NOW()
	`, sessionID, insight.ExecutiveSummary, jsonOrEmptyArray(insight.Themes), jsonOrEmptyArray(insight.Decisions), jsonOrEmptyArray(insight.RisksQuestions)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM action_items WHERE session_id = $1`, sessionID); err != nil {
		return err
	}
	for _, action := range actions {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO action_items (session_id, text, owner_alias, due_date, source_segment_ids, status)
			VALUES ($1,$2,$3,$4,$5::jsonb,$6)
		`, sessionID, action.Text, action.OwnerAlias, action.DueDate, jsonOrEmptyArray(action.SourceSegmentIDs), action.Status); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE session_analysis_jobs SET status = 'completed', finished_at = NOW() WHERE id = $1`, jobID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FailAnalysisJob(ctx context.Context, jobID int64, message string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE session_analysis_jobs SET status = 'failed', error_message = $1, finished_at = NOW()
		WHERE id = $2 AND status = 'running'
	`, truncateStoreString(message, 1000), jobID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func jsonOrEmptyArray(value json.RawMessage) string {
	if len(value) == 0 || !json.Valid(value) {
		return "[]"
	}
	return string(value)
}

func truncateStoreString(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func (s *Store) CreateSession(ctx context.Context, title, description, methodology, code, videoRoom, joinSecret string, maxParticipants int, facilitatorToken string) (model.Session, error) {
	var out model.Session
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO sessions (code, title, description, methodology, video_room, join_secret, max_participants, facilitator_token, facilitator_token_expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id, code, title, description, methodology, video_room, join_secret, max_participants, facilitator_token, facilitator_token_expires_at, voting_open, ended_at, created_at
	`, code, title, description, methodology, videoRoom, joinSecret, maxParticipants, facilitatorToken, time.Now().Add(s.facilitatorTTL)).Scan(
		&out.ID, &out.Code, &out.Title, &out.Description, &out.Methodology, &out.VideoRoom, &out.JoinSecret, &out.MaxParticipants,
		&out.FacilitatorToken, &out.FacilitatorTokenExpiresAt, &out.VotingOpen, &out.EndedAt, &out.CreatedAt,
	)
	return out, err
}

func (s *Store) GetSessionByCode(ctx context.Context, code string) (model.Session, error) {
	var out model.Session
	err := s.db.QueryRowContext(ctx, `
		SELECT id, code, title, description, methodology, video_room, join_secret, max_participants, facilitator_token, facilitator_token_expires_at, voting_open, ended_at, created_at
		FROM sessions WHERE code = $1
	`, strings.ToUpper(code)).Scan(
		&out.ID, &out.Code, &out.Title, &out.Description, &out.Methodology, &out.VideoRoom, &out.JoinSecret, &out.MaxParticipants,
		&out.FacilitatorToken, &out.FacilitatorTokenExpiresAt, &out.VotingOpen, &out.EndedAt, &out.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) CreateParticipant(ctx context.Context, sessionCode, token string) (model.Participant, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.Participant{}, err
	}
	var activeCount int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM participants
		WHERE session_id = $1 AND expires_at > NOW()
	`, session.ID).Scan(&activeCount); err != nil {
		return model.Participant{}, err
	}
	if activeCount >= session.MaxParticipants {
		return model.Participant{}, fmt.Errorf("session participant limit reached")
	}
	var out model.Participant
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO participants (session_id, token, expires_at)
		VALUES ($1,$2,$3)
		RETURNING id, session_id, token, expires_at, created_at
	`, session.ID, token, time.Now().Add(s.participantTTL)).Scan(&out.ID, &out.SessionID, &out.Token, &out.ExpiresAt, &out.CreatedAt)
	return out, err
}

func (s *Store) FindParticipantByToken(ctx context.Context, token string) (model.Participant, error) {
	var out model.Participant
	err := s.db.QueryRowContext(ctx, `SELECT id, session_id, token, expires_at, created_at FROM participants WHERE token = $1`, token).
		Scan(&out.ID, &out.SessionID, &out.Token, &out.ExpiresAt, &out.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	if err == nil && time.Now().After(out.ExpiresAt) {
		return model.Participant{}, ErrNotFound
	}
	return out, err
}

func (s *Store) RevokeParticipantToken(ctx context.Context, sessionCode, token, replacementToken string) error {
	participant, err := s.FindParticipantByToken(ctx, token)
	if err != nil {
		return err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return err
	}
	if participant.SessionID != session.ID {
		return ErrNotFound
	}
	res, err := s.db.ExecContext(ctx, `UPDATE participants SET token = $1, expires_at = $2 WHERE id = $3`, replacementToken, time.Now().Add(s.participantTTL), participant.ID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RotateFacilitatorToken(ctx context.Context, sessionCode, currentToken, replacementToken string) error {
	res, err := s.db.ExecContext(ctx, `
		UPDATE sessions
		SET facilitator_token = $1, facilitator_token_expires_at = $2, updated_at = NOW()
		WHERE code = $3 AND facilitator_token = $4
	`, replacementToken, time.Now().Add(s.facilitatorTTL), strings.ToUpper(sessionCode), currentToken)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListVoiceTemplates(ctx context.Context) ([]model.VoiceTemplate, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, slug, name, description, provider, voice_id, language, enabled, created_at, updated_at
		FROM voice_templates
		WHERE enabled = TRUE
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []model.VoiceTemplate
	for rows.Next() {
		var item model.VoiceTemplate
		if err := rows.Scan(&item.ID, &item.Slug, &item.Name, &item.Description, &item.Provider, &item.VoiceID, &item.Language, &item.Enabled, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetVoiceTemplate(ctx context.Context, id string) (model.VoiceTemplate, error) {
	var item model.VoiceTemplate
	err := s.db.QueryRowContext(ctx, `
		SELECT id, slug, name, description, provider, voice_id, language, enabled, created_at, updated_at
		FROM voice_templates
		WHERE id = $1 AND enabled = TRUE
	`, strings.TrimSpace(id)).Scan(&item.ID, &item.Slug, &item.Name, &item.Description, &item.Provider, &item.VoiceID, &item.Language, &item.Enabled, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) UpsertAnonymousAudioSettings(ctx context.Context, sessionCode, participantToken string, in model.AnonymousAudioSettings) (model.AnonymousAudioSettings, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	if participant.SessionID != session.ID {
		return model.AnonymousAudioSettings{}, ErrNotFound
	}
	now := time.Now()
	status := "off"
	if in.Enabled {
		status = "initializing"
	}
	if _, err := s.GetVoiceTemplate(ctx, in.VoiceTemplateID); err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO participant_anonymous_audio (
			session_id, participant_id, enabled, audio_mode, language_mode, preferred_language,
			voice_template_id, pii_redaction_enabled, fallback_mode, status, worker_ready,
			worker_connected, detected_language, language_confidence, latency_ms, last_error_code,
			last_error_message, language_locked, last_transition_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,FALSE,'',0,0,'','',$11,$12,NOW())
		ON CONFLICT (session_id, participant_id) DO UPDATE
		SET enabled = EXCLUDED.enabled,
		    audio_mode = EXCLUDED.audio_mode,
		    language_mode = EXCLUDED.language_mode,
		    preferred_language = EXCLUDED.preferred_language,
		    voice_template_id = EXCLUDED.voice_template_id,
		    pii_redaction_enabled = EXCLUDED.pii_redaction_enabled,
		    fallback_mode = EXCLUDED.fallback_mode,
		    status = EXCLUDED.status,
		    worker_ready = FALSE,
		    worker_connected = FALSE,
		    latency_ms = 0,
		    last_error_code = '',
		    last_error_message = '',
		    last_transition_at = EXCLUDED.last_transition_at,
		    updated_at = NOW()
	`, session.ID, participant.ID, in.Enabled, in.AudioMode, in.LanguageMode, in.PreferredLanguage, in.VoiceTemplateID, in.PIIRedactionEnabled, in.FallbackMode, status, in.LanguageLocked, now)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	return s.GetAnonymousAudioSettings(ctx, sessionCode, participantToken)
}

func (s *Store) GetAnonymousAudioSettings(ctx context.Context, sessionCode, participantToken string) (model.AnonymousAudioSettings, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	if participant.SessionID != session.ID {
		return model.AnonymousAudioSettings{}, ErrNotFound
	}
	var out model.AnonymousAudioSettings
	err = s.db.QueryRowContext(ctx, `
		SELECT session_id, participant_id, enabled, audio_mode, language_mode, preferred_language, voice_template_id,
		       pii_redaction_enabled, fallback_mode, status, worker_ready, worker_connected, detected_language,
		       language_confidence, latency_ms, last_error_code, last_error_message, language_locked, updated_at, last_transition_at
		FROM participant_anonymous_audio
		WHERE session_id = $1 AND participant_id = $2
	`, session.ID, participant.ID).Scan(
		&out.SessionID, &out.ParticipantID, &out.Enabled, &out.AudioMode, &out.LanguageMode, &out.PreferredLanguage, &out.VoiceTemplateID,
		&out.PIIRedactionEnabled, &out.FallbackMode, &out.Status, &out.WorkerReady, &out.WorkerConnected, &out.DetectedLanguage,
		&out.LanguageConfidence, &out.LatencyMs, &out.LastErrorCode, &out.LastErrorMessage, &out.LanguageLocked, &out.UpdatedAt, &out.LastTransitionAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return model.AnonymousAudioSettings{
			SessionID:         session.ID,
			ParticipantID:     participant.ID,
			AudioMode:         "normal",
			LanguageMode:      "auto",
			PreferredLanguage: "uk-UA",
			VoiceTemplateID:   "anonymous-neutral-01",
			FallbackMode:      "mute",
			Status:            "off",
			LastTransitionAt:  nil,
		}, nil
	}
	return out, err
}

func (s *Store) ListAnonymousAudioWorkItems(ctx context.Context) ([]model.AnonymousAudioWorkItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.code, pt.token, p.session_id, p.participant_id, p.audio_mode, p.language_mode, p.preferred_language,
		       p.voice_template_id, p.pii_redaction_enabled, p.fallback_mode, p.status, p.worker_ready,
		       p.worker_connected, p.detected_language, p.language_confidence, p.latency_ms,
		       p.last_error_code, p.last_error_message, p.language_locked, p.updated_at, p.last_transition_at
		FROM participant_anonymous_audio p
		JOIN sessions s ON s.id = p.session_id
		JOIN participants pt ON pt.id = p.participant_id
		WHERE p.enabled = TRUE
		  AND p.audio_mode = 'anonymous'
		  AND pt.expires_at > NOW()
		  AND s.ended_at IS NULL
		ORDER BY p.updated_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.AnonymousAudioWorkItem, 0)
	for rows.Next() {
		var out model.AnonymousAudioWorkItem
		var updatedAt time.Time
		var lastTransitionAt *time.Time
		if err := rows.Scan(
			&out.SessionCode, &out.ParticipantToken, &out.SessionID, &out.ParticipantID, &out.AudioMode, &out.LanguageMode, &out.PreferredLanguage,
			&out.VoiceTemplateID, &out.PIIRedactionEnabled, &out.FallbackMode, &out.Status, &out.WorkerReady,
			&out.WorkerConnected, &out.DetectedLanguage, &out.LanguageConfidence, &out.LatencyMs,
			&out.LastErrorCode, &out.LastErrorMessage, &out.LanguageLocked, &updatedAt, &lastTransitionAt,
		); err != nil {
			return nil, err
		}
		items = append(items, out)
	}
	return items, rows.Err()
}

func (s *Store) ListTranscriptWorkItems(ctx context.Context) ([]model.TranscriptWorkItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT s.code, s.video_room, s.video_room || '-input', p.id, p.token, COALESCE(aa.preferred_language, 'uk-UA'),
		       COALESCE(aa.audio_mode, 'normal'), COALESCE(vt.voice_id, ''),
		       (EXTRACT(EPOCH FROM COALESCE(s.media_started_at, s.created_at)) * 1000)::BIGINT
		FROM participant_transcript_consents c
		JOIN participants p ON p.id = c.participant_id
		JOIN sessions s ON s.id = c.session_id
		LEFT JOIN participant_anonymous_audio aa ON aa.session_id = c.session_id AND aa.participant_id = c.participant_id
		LEFT JOIN voice_templates vt ON vt.id = aa.voice_template_id
		WHERE c.revoked_at IS NULL AND p.expires_at > NOW() AND s.ended_at IS NULL
		ORDER BY s.code, p.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.TranscriptWorkItem, 0)
	for rows.Next() {
		var item model.TranscriptWorkItem
		if err := rows.Scan(&item.SessionCode, &item.Room, &item.InputRoom, &item.ParticipantID, &item.ParticipantToken, &item.PreferredLanguage, &item.AudioMode, &item.VoiceID, &item.SessionStartedAtMs); err != nil {
			return nil, err
		}
		item.PublicRoom = item.Room
		items = append(items, item)
	}
	return items, rows.Err()
}

// MarkMediaStarted sets the session timeline origin exactly once. A session
// can be created long before participants enter the LiveKit room, so using
// created_at would make transcript timestamps misleading.
func (s *Store) MarkMediaStarted(ctx context.Context, sessionCode string) (time.Time, error) {
	var startedAt time.Time
	err := s.db.QueryRowContext(ctx, `
		UPDATE sessions
		SET media_started_at = COALESCE(media_started_at, NOW())
		WHERE code = $1
		RETURNING media_started_at
	`, sessionCode).Scan(&startedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	return startedAt, err
}

func (s *Store) UpdateAnonymousAudioRuntime(ctx context.Context, sessionCode, participantToken string, in model.AnonymousAudioRuntimeUpdate) (model.AnonymousAudioSettings, error) {
	settings, err := s.GetAnonymousAudioSettings(ctx, sessionCode, participantToken)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}

	nextStatus := strings.TrimSpace(in.Status)
	if nextStatus == "" {
		nextStatus = settings.Status
	}
	workerReady := settings.WorkerReady
	if in.WorkerReady != nil {
		workerReady = *in.WorkerReady
	}
	workerConnected := settings.WorkerConnected
	if in.WorkerConnected != nil {
		workerConnected = *in.WorkerConnected
	}
	detectedLanguage := settings.DetectedLanguage
	if in.DetectedLanguage != nil {
		detectedLanguage = strings.TrimSpace(*in.DetectedLanguage)
	}
	languageConfidence := settings.LanguageConfidence
	if in.LanguageConfidence != nil {
		languageConfidence = *in.LanguageConfidence
	}
	latencyMs := settings.LatencyMs
	if in.LatencyMs != nil {
		latencyMs = *in.LatencyMs
	}
	lastErrorCode := settings.LastErrorCode
	if in.LastErrorCode != nil {
		lastErrorCode = strings.TrimSpace(*in.LastErrorCode)
	}
	lastErrorMessage := settings.LastErrorMessage
	if in.LastErrorMessage != nil {
		lastErrorMessage = strings.TrimSpace(*in.LastErrorMessage)
	}
	languageLocked := settings.LanguageLocked
	if in.LanguageLocked != nil {
		languageLocked = *in.LanguageLocked
	}
	now := time.Now()
	_, err = s.db.ExecContext(ctx, `
		UPDATE participant_anonymous_audio
		SET status = $1,
		    worker_ready = $2,
		    worker_connected = $3,
		    detected_language = $4,
		    language_confidence = $5,
		    latency_ms = $6,
		    last_error_code = $7,
		    last_error_message = $8,
		    language_locked = $9,
		    last_transition_at = $10,
		    updated_at = NOW()
		WHERE session_id = $11 AND participant_id = $12
	`, nextStatus, workerReady, workerConnected, detectedLanguage, languageConfidence, latencyMs, lastErrorCode, lastErrorMessage, languageLocked, now, settings.SessionID, settings.ParticipantID)
	if err != nil {
		return model.AnonymousAudioSettings{}, err
	}
	return s.GetAnonymousAudioSettings(ctx, sessionCode, participantToken)
}

func (s *Store) CreateCard(ctx context.Context, sessionCode, participantToken, text, category string) (model.Card, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.Card{}, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.Card{}, err
	}
	if participant.SessionID != session.ID {
		return model.Card{}, fmt.Errorf("participant not in session")
	}
	var out model.Card
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO cards (session_id, participant_id, text, category)
		VALUES ($1,$2,$3,$4)
		RETURNING id, session_id, text, category, vote_count, hidden, created_at
	`, session.ID, participant.ID, text, category).Scan(
		&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt,
	)
	return out, err
}

func (s *Store) ListCards(ctx context.Context, sessionCode string, includeHidden bool) ([]model.Card, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	query := `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards
		WHERE session_id = $1
	`
	if !includeHidden {
		query += ` AND hidden = false`
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, query, session.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]model.Card, 0)
	for rows.Next() {
		var c model.Card
		if err := rows.Scan(&c.ID, &c.SessionID, &c.Text, &c.Category, &c.VoteCount, &c.Hidden, &c.CreatedAt); err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

func (s *Store) VoteCard(ctx context.Context, cardID int64, participantToken string) (model.Card, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.Card{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.Card{}, err
	}
	defer tx.Rollback()

	var sessionID int64
	err = tx.QueryRowContext(ctx, `SELECT session_id FROM cards WHERE id = $1`, cardID).Scan(&sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Card{}, ErrNotFound
	}
	if err != nil {
		return model.Card{}, err
	}
	if participant.SessionID != sessionID {
		return model.Card{}, fmt.Errorf("participant not in session")
	}
	var votingOpen bool
	var endedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT voting_open, ended_at FROM sessions WHERE id = $1`, sessionID).Scan(&votingOpen, &endedAt)
	if err != nil {
		return model.Card{}, err
	}
	if !votingOpen || endedAt.Valid {
		return model.Card{}, fmt.Errorf("voting is closed")
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO votes(card_id, participant_id) VALUES ($1,$2)`, cardID, participant.ID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return model.Card{}, ErrDuplicateVote
		}
		return model.Card{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE cards SET vote_count = vote_count + 1, updated_at = NOW() WHERE id = $1`, cardID)
	if err != nil {
		return model.Card{}, err
	}
	var out model.Card
	err = tx.QueryRowContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards WHERE id = $1
	`, cardID).Scan(&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt)
	if err != nil {
		return model.Card{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.Card{}, err
	}
	return out, nil
}

func (s *Store) UpdateCard(ctx context.Context, cardID int64, hidden *bool, category *string, text *string) (model.Card, error) {
	set := make([]string, 0, 4)
	args := make([]interface{}, 0, 4)
	argPos := 1
	if hidden != nil {
		set = append(set, fmt.Sprintf("hidden = $%d", argPos))
		args = append(args, *hidden)
		argPos++
	}
	if category != nil {
		set = append(set, fmt.Sprintf("category = $%d", argPos))
		args = append(args, *category)
		argPos++
	}
	if text != nil {
		set = append(set, fmt.Sprintf("text = $%d", argPos))
		args = append(args, *text)
		argPos++
	}
	if len(set) == 0 {
		return s.GetCard(ctx, cardID)
	}
	set = append(set, "updated_at = NOW()")
	query := fmt.Sprintf("UPDATE cards SET %s WHERE id = $%d", strings.Join(set, ","), argPos)
	args = append(args, cardID)
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return model.Card{}, err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return model.Card{}, ErrNotFound
	}
	return s.GetCard(ctx, cardID)
}

func (s *Store) GetCard(ctx context.Context, cardID int64) (model.Card, error) {
	var out model.Card
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards WHERE id = $1
	`, cardID).Scan(&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) UpdateSessionState(ctx context.Context, code string, votingOpen *bool, endSession bool) (model.Session, error) {
	parts := []string{}
	args := []interface{}{}
	argPos := 1
	if votingOpen != nil {
		parts = append(parts, fmt.Sprintf("voting_open = $%d", argPos))
		args = append(args, *votingOpen)
		argPos++
	}
	if endSession {
		parts = append(parts, "ended_at = NOW()")
	}
	if len(parts) > 0 {
		query := fmt.Sprintf("UPDATE sessions SET %s, updated_at = NOW() WHERE code = $%d", strings.Join(parts, ","), argPos)
		args = append(args, strings.ToUpper(code))
		res, err := s.db.ExecContext(ctx, query, args...)
		if err != nil {
			return model.Session{}, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return model.Session{}, ErrNotFound
		}
	}
	return s.GetSessionByCode(ctx, code)
}

func (s *Store) UpsertSummary(ctx context.Context, code, markdown, grouped, risks, actions string) (model.Summary, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return model.Summary{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO summaries(session_id, markdown, grouped_thoughts, risks_questions, action_items)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT(session_id) DO UPDATE SET
			markdown = EXCLUDED.markdown,
			grouped_thoughts = EXCLUDED.grouped_thoughts,
			risks_questions = EXCLUDED.risks_questions,
			action_items = EXCLUDED.action_items,
			updated_at = NOW()
	`, session.ID, markdown, grouped, risks, actions)
	if err != nil {
		return model.Summary{}, err
	}
	return s.GetSummary(ctx, code)
}

func (s *Store) GetSummary(ctx context.Context, code string) (model.Summary, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return model.Summary{}, err
	}
	var out model.Summary
	err = s.db.QueryRowContext(ctx, `
		SELECT s.session_id, sess.code, s.markdown, s.grouped_thoughts, s.risks_questions, s.action_items, s.updated_at
		FROM summaries s
		JOIN sessions sess ON sess.id = s.session_id
		WHERE s.session_id = $1
	`, session.ID).Scan(
		&out.SessionID, &out.Code, &out.Markdown, &out.GroupedThought,
		&out.RisksQuestions, &out.ActionItems, &out.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) GetTopCards(ctx context.Context, code string, limit int) ([]model.Card, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards
		WHERE session_id = $1 AND hidden = false
		ORDER BY vote_count DESC, created_at ASC
		LIMIT $2
	`, session.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := []model.Card{}
	for rows.Next() {
		var c model.Card
		if err := rows.Scan(&c.ID, &c.SessionID, &c.Text, &c.Category, &c.VoteCount, &c.Hidden, &c.CreatedAt); err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

func (s *Store) GetSessionCodeByID(ctx context.Context, sessionID int64) (string, error) {
	var code string
	err := s.db.QueryRowContext(ctx, `SELECT code FROM sessions WHERE id = $1`, sessionID).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return code, err
}
