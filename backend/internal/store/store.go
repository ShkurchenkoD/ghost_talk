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
