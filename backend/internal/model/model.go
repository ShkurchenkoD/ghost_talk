package model

import (
	"encoding/json"
	"time"
)

type Session struct {
	ID                        int64      `json:"id"`
	Code                      string     `json:"code"`
	Title                     string     `json:"title"`
	Description               string     `json:"description"`
	Methodology               string     `json:"methodology"`
	VideoRoom                 string     `json:"video_room"`
	JoinSecret                string     `json:"join_secret,omitempty"`
	MaxParticipants           int        `json:"max_participants"`
	FacilitatorToken          string     `json:"facilitator_token,omitempty"`
	FacilitatorTokenExpiresAt time.Time  `json:"facilitator_token_expires_at"`
	VotingOpen                bool       `json:"voting_open"`
	EndedAt                   *time.Time `json:"ended_at,omitempty"`
	CreatedAt                 time.Time  `json:"created_at"`
}

type Participant struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Card struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Text      string    `json:"text"`
	Category  string    `json:"category"`
	VoteCount int       `json:"vote_count"`
	Hidden    bool      `json:"hidden"`
	CreatedAt time.Time `json:"created_at"`
}

type Summary struct {
	SessionID      int64     `json:"session_id"`
	Code           string    `json:"code"`
	Markdown       string    `json:"markdown"`
	GroupedThought string    `json:"grouped_thoughts"`
	RisksQuestions string    `json:"risks_questions"`
	ActionItems    string    `json:"action_items"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type Event struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type AuditEvent struct {
	ID         int64     `json:"id"`
	SessionID  int64     `json:"session_id"`
	EventType  string    `json:"event_type"`
	ActorRole  string    `json:"actor_role"`
	ActorToken string    `json:"actor_token,omitempty"`
	ClientIP   string    `json:"client_ip"`
	UserAgent  string    `json:"user_agent"`
	Details    string    `json:"details"`
	CreatedAt  time.Time `json:"created_at"`
}

type VoiceTemplate struct {
	ID          string    `json:"id"`
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Provider    string    `json:"provider"`
	VoiceID     string    `json:"voice_id"`
	Language    *string   `json:"language,omitempty"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AnonymousAudioSettings struct {
	SessionID           int64      `json:"session_id"`
	ParticipantID       int64      `json:"participant_id"`
	Enabled             bool       `json:"enabled"`
	AudioMode           string     `json:"audio_mode"`
	LanguageMode        string     `json:"language_mode"`
	PreferredLanguage   string     `json:"preferred_language"`
	VoiceTemplateID     string     `json:"voice_template_id"`
	PIIRedactionEnabled bool       `json:"pii_redaction_enabled"`
	FallbackMode        string     `json:"fallback_mode"`
	Status              string     `json:"status"`
	WorkerReady         bool       `json:"worker_ready"`
	WorkerConnected     bool       `json:"worker_connected"`
	DetectedLanguage    string     `json:"detected_language"`
	LanguageConfidence  float64    `json:"language_confidence"`
	LatencyMs           int        `json:"latency_ms"`
	LastErrorCode       string     `json:"last_error_code"`
	LastErrorMessage    string     `json:"last_error_message"`
	LanguageLocked      bool       `json:"language_locked"`
	UpdatedAt           time.Time  `json:"updated_at"`
	LastTransitionAt    *time.Time `json:"last_transition_at,omitempty"`
}

type AnonymousAudioRuntimeUpdate struct {
	SessionCode        string   `json:"session_code"`
	ParticipantToken   string   `json:"participant_token"`
	Status             string   `json:"status"`
	WorkerReady        *bool    `json:"worker_ready,omitempty"`
	WorkerConnected    *bool    `json:"worker_connected,omitempty"`
	DetectedLanguage   *string  `json:"detected_language,omitempty"`
	LanguageConfidence *float64 `json:"language_confidence,omitempty"`
	LatencyMs          *int     `json:"latency_ms,omitempty"`
	LastErrorCode      *string  `json:"last_error_code,omitempty"`
	LastErrorMessage   *string  `json:"last_error_message,omitempty"`
	LanguageLocked     *bool    `json:"language_locked,omitempty"`
}

type AnonymousAudioWorkItem struct {
	SessionCode         string  `json:"session_code"`
	ParticipantToken    string  `json:"participant_token"`
	SessionID           int64   `json:"session_id"`
	ParticipantID       int64   `json:"participant_id"`
	AudioMode           string  `json:"audio_mode"`
	LanguageMode        string  `json:"language_mode"`
	PreferredLanguage   string  `json:"preferred_language"`
	VoiceTemplateID     string  `json:"voice_template_id"`
	FallbackMode        string  `json:"fallback_mode"`
	Status              string  `json:"status"`
	WorkerReady         bool    `json:"worker_ready"`
	WorkerConnected     bool    `json:"worker_connected"`
	DetectedLanguage    string  `json:"detected_language"`
	LanguageConfidence  float64 `json:"language_confidence"`
	LatencyMs           int     `json:"latency_ms"`
	LastErrorCode       string  `json:"last_error_code"`
	LastErrorMessage    string  `json:"last_error_message"`
	LanguageLocked      bool    `json:"language_locked"`
	PIIRedactionEnabled bool    `json:"pii_redaction_enabled"`
}

// TranscriptSegment is a finalized portion of a session transcript.
// ParticipantAlias is session-scoped and must never contain a real name.
type TranscriptSegment struct {
	ID               int64     `json:"id"`
	SessionID        int64     `json:"session_id"`
	ParticipantID    int64     `json:"participant_id,omitempty"`
	ParticipantAlias string    `json:"participant_alias"`
	SegmentKey       string    `json:"-"`
	TrackSID         string    `json:"track_sid,omitempty"`
	StartedAtMs      int64     `json:"started_at_ms"`
	EndedAtMs        int64     `json:"ended_at_ms"`
	Text             string    `json:"text"`
	Language         string    `json:"language,omitempty"`
	Confidence       float64   `json:"confidence"`
	IsFinal          bool      `json:"is_final"`
	Redacted         bool      `json:"redacted"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// TranscriptWorkItem is service-to-service data for the media worker. The
// participant token never leaves the internal Docker network.
type TranscriptWorkItem struct {
	SessionCode        string `json:"session_code"`
	Room               string `json:"room"`
	InputRoom          string `json:"input_room"`
	PublicRoom         string `json:"public_room"`
	ParticipantID      int64  `json:"participant_id"`
	ParticipantToken   string `json:"participant_token"`
	PreferredLanguage  string `json:"preferred_language"`
	AudioMode          string `json:"audio_mode"`
	VoiceID            string `json:"voice_id"`
	SessionStartedAtMs int64  `json:"session_started_at_ms"`
}

type SessionInsight struct {
	SessionID        int64           `json:"session_id"`
	ExecutiveSummary string          `json:"executive_summary"`
	Themes           json.RawMessage `json:"themes"`
	Decisions        json.RawMessage `json:"decisions"`
	RisksQuestions   json.RawMessage `json:"risks_questions"`
	GeneratedAt      *time.Time      `json:"generated_at,omitempty"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type ActionItem struct {
	ID               int64           `json:"id"`
	SessionID        int64           `json:"session_id"`
	Text             string          `json:"text"`
	OwnerAlias       string          `json:"owner_alias,omitempty"`
	DueDate          *time.Time      `json:"due_date,omitempty"`
	SourceSegmentIDs json.RawMessage `json:"source_segment_ids"`
	Status           string          `json:"status"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

type AnalysisJob struct {
	ID              int64      `json:"id"`
	SessionID       int64      `json:"session_id"`
	Status          string     `json:"status"`
	RequestedByRole string     `json:"requested_by_role"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	FinishedAt      *time.Time `json:"finished_at,omitempty"`
}
