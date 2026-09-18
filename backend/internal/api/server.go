package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"mime/multipart"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"

	"ghosttalk/backend/internal/model"
	"ghosttalk/backend/internal/realtime"
	"ghosttalk/backend/internal/store"
	"ghosttalk/backend/internal/util"
)

type Server struct {
	store                   *store.Store
	hub                     *realtime.Hub
	mux                     *http.ServeMux
	whisperURL              string
	ttsURL                  string
	anonymousAudioWorkerURL string
	livekitURL              string
	apiKey                  string
	apiSecret               string
	facilitatorTTL          time.Duration
	participantTTL          time.Duration
	allowedOrigins          map[string]struct{}
	limiter                 *rateLimiter
	httpClient              *http.Client
}

func New(st *store.Store, hub *realtime.Hub, whisperURL, ttsURL, anonymousAudioWorkerURL, livekitURL, apiKey, apiSecret string, facilitatorTTL, participantTTL time.Duration, allowedOrigins []string) *Server {
	s := &Server{
		store:                   st,
		hub:                     hub,
		mux:                     http.NewServeMux(),
		whisperURL:              whisperURL,
		ttsURL:                  ttsURL,
		anonymousAudioWorkerURL: strings.TrimRight(strings.TrimSpace(anonymousAudioWorkerURL), "/"),
		livekitURL:              strings.TrimRight(strings.TrimSpace(livekitURL), "/"),
		apiKey:                  strings.TrimSpace(apiKey),
		apiSecret:               strings.TrimSpace(apiSecret),
		facilitatorTTL:          facilitatorTTL,
		participantTTL:          participantTTL,
		allowedOrigins:          normalizeAllowedOrigins(allowedOrigins),
		limiter:                 newRateLimiter(),
		httpClient:              &http.Client{Timeout: 90 * time.Second},
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler { return s.withCORS(s.mux) }

func (s *Server) routes() {
	s.mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	s.mux.HandleFunc("/api/sessions", s.handleSessions)
	s.mux.HandleFunc("/api/sessions/", s.handleSessionRoutes)
	s.mux.HandleFunc("/api/session-access/", s.handleSessionAccess)
	s.mux.HandleFunc("/api/cards/", s.handleCardRoutes)
	s.mux.HandleFunc("/api/transcribe", s.handleTranscribe)
	s.mux.HandleFunc("/api/synthesize", s.handleSynthesize)
	s.mux.HandleFunc("/api/v1/voice-templates", s.handleVoiceTemplates)
	s.mux.HandleFunc("/api/v1/rooms/", s.handleAnonymousAudioRoutes)
	s.mux.HandleFunc("/api/internal/anonymous-audio/work-items", s.handleAnonymousAudioWorkItems)
	s.mux.HandleFunc("/api/internal/anonymous-audio/runtime", s.handleAnonymousAudioRuntime)
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "create_session", 10, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	var in struct {
		Title           string `json:"title"`
		Description     string `json:"description"`
		Methodology     string `json:"methodology"`
		JoinSecret      string `json:"join_secret"`
		MaxParticipants int    `json:"max_participants"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.Methodology = normalizeMethodology(in.Methodology)
	in.JoinSecret = strings.TrimSpace(in.JoinSecret)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > 120 {
		writeError(w, r, http.StatusBadRequest, "title required (1..120 chars)")
		return
	}
	if utf8.RuneCountInString(in.Description) > 1000 {
		writeError(w, r, http.StatusBadRequest, "description too long")
		return
	}
	if !isSupportedMethodology(in.Methodology) {
		writeError(w, r, http.StatusBadRequest, "unsupported methodology")
		return
	}
	if len(in.JoinSecret) > 64 {
		writeError(w, r, http.StatusBadRequest, "join secret too long")
		return
	}
	if in.MaxParticipants <= 0 {
		in.MaxParticipants = 100
	}
	if in.MaxParticipants > 500 {
		writeError(w, r, http.StatusBadRequest, "max participants too high")
		return
	}
	ctx := r.Context()
	var session model.Session
	var err error
	for i := 0; i < 5; i++ {
		code := util.NewCode(6)
		videoRoom := buildVideoRoomName(code)
		session, err = s.store.CreateSession(ctx, in.Title, in.Description, in.Methodology, code, videoRoom, in.JoinSecret, in.MaxParticipants, util.NewToken(24))
		if err == nil {
			break
		}
	}
	if err != nil {
		log.Printf("create session: %v", err)
		writeError(w, r, http.StatusInternalServerError, "failed to create session")
		return
	}
	setSessionTokenCookie(w, "facilitator", session.Code, session.FacilitatorToken, s.facilitatorTTL, isSecureRequest(r))
	s.auditRequest(r, session.ID, "session_created", "facilitator", session.FacilitatorToken, map[string]interface{}{
		"code":             session.Code,
		"methodology":      session.Methodology,
		"has_join_secret":  in.JoinSecret != "",
		"max_participants": in.MaxParticipants,
	})
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"session":             s.exposeSession(session),
		"facilitator_token":   session.FacilitatorToken,
		"join_code":           session.Code,
		"join_link":           fmt.Sprintf("/session/%s", session.Code),
		"facilitator_link":    fmt.Sprintf("/facilitator/%s", session.Code),
		"methodology_options": categoriesFor(session.Methodology),
	})
}

func (s *Server) handleSessionRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	code := strings.ToUpper(parts[0])
	if len(parts) == 1 {
		s.handleSessionByCode(w, r, code)
		return
	}
	switch parts[1] {
	case "join":
		s.handleJoin(w, r, code)
	case "captcha":
		s.handleJoinCaptcha(w, r, code)
	case "video-token":
		s.handleVideoToken(w, r, code)
	case "cards":
		s.handleSessionCards(w, r, code)
	case "summary":
		s.handleSummary(w, r, code)
	case "audit":
		s.handleAudit(w, r, code)
	case "events":
		s.handleEvents(w, r, code)
	default:
		writeError(w, r, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleSessionAccess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	path := strings.TrimPrefix(r.URL.Path, "/api/session-access/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	role := strings.TrimSpace(parts[0])
	if role != "participant" && role != "facilitator" {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	code := strings.ToUpper(strings.TrimSpace(parts[1]))
	if code == "" {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	switch role {
	case "participant":
		token := participantTokenFromRequest(r)
		if token == "" {
			writeError(w, r, http.StatusUnauthorized, "missing participant token")
			return
		}
		if err := s.store.RevokeParticipantToken(r.Context(), code, token, util.NewToken(24)); err != nil {
			writeError(w, r, http.StatusUnauthorized, "invalid participant token")
			return
		}
	case "facilitator":
		token := facilitatorTokenFromRequest(r)
		if token == "" {
			writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
			return
		}
		if err := s.store.RotateFacilitatorToken(r.Context(), code, token, util.NewToken(24)); err != nil {
			writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
			return
		}
	}
	clearSessionTokenCookie(w, role, code, isSecureRequest(r))
	if session, err := s.store.GetSessionByCode(r.Context(), code); err == nil {
		s.auditRequest(r, session.ID, "session_access_cleared", role, "", map[string]interface{}{"code": code})
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared"})
}

func (s *Server) handleSessionByCode(w http.ResponseWriter, r *http.Request, code string) {
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "session not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "failed to load session")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"session":     s.exposeSession(session),
			"categories":  categoriesFor(session.Methodology),
			"methodology": session.Methodology,
		})
	case http.MethodPatch:
		if !hasFacilitatorAccess(r, session) {
			writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
			return
		}
		var in struct {
			VotingOpen *bool `json:"voting_open"`
			EndSession bool  `json:"end_session"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid JSON")
			return
		}
		updated, err := s.store.UpdateSessionState(r.Context(), code, in.VotingOpen, in.EndSession)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to update session")
			return
		}
		s.auditRequest(r, updated.ID, "session_updated", "facilitator", facilitatorTokenFromRequest(r), map[string]interface{}{
			"voting_open": in.VotingOpen,
			"end_session": in.EndSession,
		})
		s.publish(code, "session_updated", s.exposeSession(updated))
		writeJSON(w, http.StatusOK, map[string]interface{}{"session": s.exposeSession(updated)})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "join_session", 30, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	var in struct {
		JoinSecret    string `json:"join_secret"`
		CaptchaAnswer string `json:"captcha_answer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	if session.JoinSecret != "" && strings.TrimSpace(in.JoinSecret) != session.JoinSecret {
		writeError(w, r, http.StatusUnauthorized, "invalid join secret")
		return
	}
	if session.JoinSecret != "" || true {
		if !validateJoinCaptcha(r, code, strings.TrimSpace(in.CaptchaAnswer)) {
			writeError(w, r, http.StatusUnauthorized, "invalid captcha")
			return
		}
		clearJoinCaptchaCookie(w, code, isSecureRequest(r))
	}
	participant, err := s.store.CreateParticipant(r.Context(), code, util.NewToken(24))
	if err != nil {
		if strings.Contains(err.Error(), "participant limit reached") {
			writeError(w, r, http.StatusConflict, "session is full")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "failed to join session")
		return
	}
	setSessionTokenCookie(w, "participant", session.Code, participant.Token, s.participantTTL, isSecureRequest(r))
	s.auditRequest(r, session.ID, "participant_joined", "participant", participant.Token, map[string]interface{}{
		"code": session.Code,
	})
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"participant_token": participant.Token,
		"session":           s.exposeSession(session),
		"categories":        categoriesFor(session.Methodology),
	})
}

func (s *Server) handleJoinCaptcha(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	_ = session
	a := randomIntInRange(1, 9)
	b := randomIntInRange(1, 9)
	answer := strconv.Itoa(a + b)
	setJoinCaptchaCookie(w, code, answer, 5*time.Minute, isSecureRequest(r))
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"question": fmt.Sprintf("%d + %d = ?", a, b),
	})
}

func (s *Server) handleSessionCards(w http.ResponseWriter, r *http.Request, code string) {
	switch r.Method {
	case http.MethodGet:
		includeHidden := r.URL.Query().Get("include_hidden") == "1"
		if includeHidden {
			session, err := s.store.GetSessionByCode(r.Context(), code)
			if err != nil || !hasFacilitatorAccess(r, session) {
				writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
				return
			}
		}
		cards, err := s.store.ListCards(r.Context(), code, includeHidden)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to list cards")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"cards": cards})
	case http.MethodPost:
		if !s.allowRequest(r, "create_card", 60, time.Minute) {
			writeError(w, r, http.StatusTooManyRequests, "too many requests")
			return
		}
		var in struct {
			Text     string `json:"text"`
			Category string `json:"category"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid JSON")
			return
		}
		in.Text = strings.TrimSpace(in.Text)
		if in.Text == "" || utf8.RuneCountInString(in.Text) > 1000 {
			writeError(w, r, http.StatusBadRequest, "text required (1..1000 chars)")
			return
		}
		session, err := s.store.GetSessionByCode(r.Context(), code)
		if err != nil {
			writeError(w, r, http.StatusNotFound, "session not found")
			return
		}
		if session.EndedAt != nil {
			writeError(w, r, http.StatusConflict, "session already ended")
			return
		}
		if !isAllowedCategory(session.Methodology, in.Category) {
			writeError(w, r, http.StatusBadRequest, "invalid category")
			return
		}
		participantToken := participantTokenFromRequest(r)
		if participantToken == "" {
			writeError(w, r, http.StatusUnauthorized, "missing participant token")
			return
		}
		card, err := s.store.CreateCard(r.Context(), code, participantToken, in.Text, in.Category)
		if err != nil {
			writeError(w, r, http.StatusBadRequest, "failed to create card")
			return
		}
		s.auditRequest(r, card.SessionID, "card_created", "participant", participantToken, map[string]interface{}{
			"card_id":   card.ID,
			"category":  card.Category,
			"text_size": len(card.Text),
		})
		s.publish(code, "card_created", card)
		writeJSON(w, http.StatusCreated, map[string]interface{}{"card": card})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleVideoToken(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "video_token", 30, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	if !s.videoEnabled() {
		writeError(w, r, http.StatusServiceUnavailable, "video service is not configured")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	var in struct {
		DisplayName string `json:"display_name"`
		AudioMode   string `json:"audio_mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	displayName := normalizeDisplayName(in.DisplayName)
	if displayName == "" {
		writeError(w, r, http.StatusBadRequest, "display name required")
		return
	}

	isFacilitator := hasFacilitatorAccess(r, session)
	if isFacilitator {
	} else {
		participantToken := participantTokenFromRequest(r)
		if participantToken == "" {
			writeError(w, r, http.StatusUnauthorized, "missing participant token")
			return
		}
		participant, err := s.store.FindParticipantByToken(r.Context(), participantToken)
		if err != nil || participant.SessionID != session.ID {
			writeError(w, r, http.StatusUnauthorized, "invalid participant token")
			return
		}
	}

	audioMode := normalizeAudioMode(in.AudioMode)
	token, err := s.issueVideoToken(session.VideoRoom, displayName, displayName, isFacilitator, audioMode)
	if err != nil {
		log.Printf("issue livekit token: %v", err)
		writeError(w, r, http.StatusInternalServerError, "failed to create video token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"room":         session.VideoRoom,
		"server_url":   s.livekitURL,
		"token":        token,
		"display_name": displayName,
		"audio_mode":   audioMode,
		"is_moderator": isFacilitator,
	})
}

func (s *Server) handleVoiceTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	items, err := s.store.ListVoiceTemplates(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load voice templates")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (s *Server) handleAnonymousAudioRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/rooms/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 4 || parts[1] != "participants" || parts[2] != "me" || parts[3] != "anonymous-audio" {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	roomID := strings.TrimSpace(parts[0])
	switch {
	case len(parts) == 4:
		s.handleAnonymousAudioSettings(w, r, roomID)
	case len(parts) == 5 && parts[4] == "status":
		s.handleAnonymousAudioStatus(w, r, roomID)
	default:
		writeError(w, r, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleAnonymousAudioSettings(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodPut {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	participantToken := participantTokenFromRequest(r)
	if participantToken == "" {
		writeError(w, r, http.StatusUnauthorized, "missing participant token")
		return
	}
	var in struct {
		Enabled             bool   `json:"enabled"`
		LanguageMode        string `json:"language_mode"`
		PreferredLanguage   string `json:"preferred_language"`
		VoiceTemplateID     string `json:"voice_template_id"`
		PIIRedactionEnabled bool   `json:"pii_redaction_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	if in.Enabled && !s.anonymousAudioWorkerReady(r.Context()) {
		writeError(w, r, http.StatusServiceUnavailable, "anonymous audio worker unavailable")
		return
	}
	settings, err := s.store.UpsertAnonymousAudioSettings(r.Context(), roomID, participantToken, model.AnonymousAudioSettings{
		Enabled:             in.Enabled,
		AudioMode:           map[bool]string{true: "anonymous", false: "normal"}[in.Enabled],
		LanguageMode:        normalizeLanguageMode(in.LanguageMode),
		PreferredLanguage:   normalizePreferredLanguage(in.PreferredLanguage),
		VoiceTemplateID:     normalizeVoiceTemplateID(in.VoiceTemplateID),
		PIIRedactionEnabled: in.PIIRedactionEnabled,
		FallbackMode:        "mute",
		LanguageLocked:      normalizeLanguageMode(in.LanguageMode) == "manual",
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusUnprocessableEntity, "voice template not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "failed to save anonymous audio settings")
		return
	}
	voiceTemplate, _ := s.store.GetVoiceTemplate(r.Context(), settings.VoiceTemplateID)
	writeJSON(w, http.StatusOK, s.exposeAnonymousAudioStatus(settings, voiceTemplate))
}

func (s *Server) handleAnonymousAudioStatus(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	participantToken := participantTokenFromRequest(r)
	if participantToken == "" {
		writeError(w, r, http.StatusUnauthorized, "missing participant token")
		return
	}
	settings, err := s.store.GetAnonymousAudioSettings(r.Context(), roomID, participantToken)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "anonymous audio settings not found")
		return
	}
	voiceTemplate, _ := s.store.GetVoiceTemplate(r.Context(), settings.VoiceTemplateID)
	writeJSON(w, http.StatusOK, s.exposeAnonymousAudioStatus(settings, voiceTemplate))
}

func (s *Server) handleAnonymousAudioWorkItems(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	items, err := s.store.ListAnonymousAudioWorkItems(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load anonymous audio work items")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": items})
}

func (s *Server) handleAnonymousAudioRuntime(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in model.AnonymousAudioRuntimeUpdate
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	in.SessionCode = strings.ToUpper(strings.TrimSpace(in.SessionCode))
	in.ParticipantToken = strings.TrimSpace(in.ParticipantToken)
	if in.SessionCode == "" || in.ParticipantToken == "" {
		writeError(w, r, http.StatusBadRequest, "session_code and participant_token are required")
		return
	}
	settings, err := s.store.UpdateAnonymousAudioRuntime(r.Context(), in.SessionCode, in.ParticipantToken, in)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "anonymous audio settings not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "failed to update anonymous audio runtime")
		return
	}
	voiceTemplate, _ := s.store.GetVoiceTemplate(r.Context(), settings.VoiceTemplateID)
	s.publishAnonymousAudioEvent(in.SessionCode, settings, voiceTemplate)
	writeJSON(w, http.StatusOK, s.exposeAnonymousAudioStatus(settings, voiceTemplate))
}

func (s *Server) handleCardRoutes(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/cards/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid card id")
		return
	}
	if len(parts) == 2 && parts[1] == "vote" {
		s.handleVote(w, r, id)
		return
	}
	if len(parts) == 1 {
		s.handleCardPatch(w, r, id)
		return
	}
	writeError(w, r, http.StatusNotFound, "not found")
}

func (s *Server) handleVote(w http.ResponseWriter, r *http.Request, cardID int64) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "vote_card", 120, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	participantToken := participantTokenFromRequest(r)
	if participantToken == "" {
		writeError(w, r, http.StatusUnauthorized, "missing participant token")
		return
	}
	card, err := s.store.VoteCard(r.Context(), cardID, participantToken)
	if err != nil {
		if errors.Is(err, store.ErrDuplicateVote) {
			writeError(w, r, http.StatusConflict, "participant already voted for this card")
			return
		}
		writeError(w, r, http.StatusBadRequest, "failed to vote card")
		return
	}
	s.auditRequest(r, card.SessionID, "card_voted", "participant", participantToken, map[string]interface{}{
		"card_id": card.ID,
	})
	code, err := s.store.GetSessionCodeByID(r.Context(), card.SessionID)
	if err == nil {
		s.publish(code, "card_voted", card)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"card": card})
}

func (s *Server) handleCardPatch(w http.ResponseWriter, r *http.Request, cardID int64) {
	if r.Method != http.MethodPatch {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	card, err := s.store.GetCard(r.Context(), cardID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "card not found")
		return
	}
	code, err := s.store.GetSessionCodeByID(r.Context(), card.SessionID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "session not found")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil || !hasFacilitatorAccess(r, session) {
		writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
		return
	}
	var in struct {
		Hidden   *bool   `json:"hidden"`
		Category *string `json:"category"`
		Text     *string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	if in.Category != nil && !isAllowedCategory(session.Methodology, *in.Category) {
		writeError(w, r, http.StatusBadRequest, "invalid category")
		return
	}
	if in.Text != nil {
		t := strings.TrimSpace(*in.Text)
		if t == "" || utf8.RuneCountInString(t) > 1000 {
			writeError(w, r, http.StatusBadRequest, "text required (1..1000 chars)")
			return
		}
		in.Text = &t
	}
	updated, err := s.store.UpdateCard(r.Context(), cardID, in.Hidden, in.Category, in.Text)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to update card")
		return
	}
	textSize := 0
	if in.Text != nil {
		textSize = len(*in.Text)
	}
	s.auditRequest(r, updated.SessionID, "card_updated", "facilitator", facilitatorTokenFromRequest(r), map[string]interface{}{
		"card_id":   updated.ID,
		"hidden":    in.Hidden,
		"category":  in.Category,
		"text_size": textSize,
	})
	s.publish(code, "card_updated", updated)
	writeJSON(w, http.StatusOK, map[string]interface{}{"card": updated})
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request, code string) {
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if !hasFacilitatorAccess(r, session) {
			writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
			return
		}
		summary, err := s.store.GetSummary(r.Context(), code)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusInternalServerError, "failed to load summary")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			summary = model.Summary{}
		}
		topCards, err := s.store.GetTopCards(r.Context(), code, 5)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to load top cards")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"summary":   summary,
			"top_cards": topCards,
			"session":   s.exposeSession(session),
		})
	case http.MethodPost:
		if !hasFacilitatorAccess(r, session) {
			writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
			return
		}
		var in struct {
			Markdown       string `json:"markdown"`
			GroupedThought string `json:"grouped_thoughts"`
			RisksQuestions string `json:"risks_questions"`
			ActionItems    string `json:"action_items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid JSON")
			return
		}
		if len(in.Markdown) > 20000 {
			writeError(w, r, http.StatusBadRequest, "summary markdown too long")
			return
		}
		summary, err := s.store.UpsertSummary(r.Context(), code, in.Markdown, in.GroupedThought, in.RisksQuestions, in.ActionItems)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "failed to save summary")
			return
		}
		s.auditRequest(r, session.ID, "summary_saved", "facilitator", facilitatorTokenFromRequest(r), map[string]interface{}{
			"markdown_size":        len(in.Markdown),
			"grouped_thoughts_len": len(in.GroupedThought),
			"risks_questions_len":  len(in.RisksQuestions),
			"action_items_len":     len(in.ActionItems),
		})
		s.publish(code, "summary_updated", summary)
		writeJSON(w, http.StatusOK, map[string]interface{}{"summary": summary})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleAudit(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	if !hasFacilitatorAccess(r, session) {
		writeError(w, r, http.StatusUnauthorized, "invalid facilitator token")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	var beforeID int64
	if raw := strings.TrimSpace(r.URL.Query().Get("before_id")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			writeError(w, r, http.StatusBadRequest, "invalid audit cursor")
			return
		}
		beforeID = v
	}
	events, err := s.store.ListAuditEvents(r.Context(), code, limit, beforeID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to load audit events")
		return
	}
	var nextBeforeID int64
	if len(events) == limit {
		nextBeforeID = events[len(events)-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"events":         events,
		"next_before_id": nextBeforeID,
		"session":        s.exposeSession(session),
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "events", 30, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	_, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ctx := r.Context()
	client := s.hub.Subscribe(code)
	defer s.hub.Unsubscribe(code, client)

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	_, _ = w.Write([]byte(": connected\n\n"))
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = w.Write([]byte(": keepalive\n\n"))
			flusher.Flush()
		case msg := <-client:
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(msg)
			_, _ = w.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}

func (s *Server) handleTranscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "transcribe", 12, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 25<<20)
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid multipart form")
		return
	}
	file, header, err := r.FormFile("audio")
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "missing audio file")
		return
	}
	defer file.Close()

	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", header.Filename)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "transcription failed")
		return
	}
	if _, err = io.Copy(fw, file); err != nil {
		writeError(w, r, http.StatusInternalServerError, "transcription failed")
		return
	}
	_ = mw.WriteField("model", "Systran/faster-whisper-small")
	lang := r.FormValue("language")
	if lang == "" {
		lang = "uk"
	}
	_ = mw.WriteField("language", lang)
	mw.Close()

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.whisperURL+"/v1/audio/transcriptions", &buf)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "transcription failed")
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("whisper request failed: %v", err)
		writeError(w, r, http.StatusBadGateway, "transcription service unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		log.Printf("whisper request returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			writeError(w, r, http.StatusUnprocessableEntity, "unsupported audio format")
			return
		}
		writeError(w, r, http.StatusBadGateway, "transcription service unavailable")
		return
	}

	var result struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("whisper response decode failed: %v", err)
		writeError(w, r, http.StatusBadGateway, "transcription failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": strings.TrimSpace(result.Text)})
}

func (s *Server) handleSynthesize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.allowRequest(r, "synthesize", 30, time.Minute) {
		writeError(w, r, http.StatusTooManyRequests, "too many requests")
		return
	}

	var in struct {
		Text  string `json:"text"`
		Voice string `json:"voice"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	text := strings.TrimSpace(in.Text)
	if text == "" {
		writeError(w, r, http.StatusBadRequest, "text is required")
		return
	}

	body, err := json.Marshal(map[string]string{"text": text, "voice": in.Voice})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "synthesis failed")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.ttsURL+"/synthesize", bytes.NewReader(body))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "synthesis failed")
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("tts request failed: %v", err)
		writeError(w, r, http.StatusBadGateway, "synthesis service unavailable")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		log.Printf("tts request returned %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			writeError(w, r, http.StatusUnprocessableEntity, "unsupported voice or text")
			return
		}
		writeError(w, r, http.StatusBadGateway, "synthesis service unavailable")
		return
	}

	w.Header().Set("Content-Type", "audio/wav")
	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("tts response copy failed: %v", err)
	}
}

func (s *Server) publish(code, eventType string, payload interface{}) {
	data, err := json.Marshal(model.Event{Type: eventType, Payload: payload})
	if err != nil {
		return
	}
	s.hub.Broadcast(code, data)
}

func (s *Server) publishAnonymousAudioEvent(code string, settings model.AnonymousAudioSettings, voiceTemplate model.VoiceTemplate) {
	eventType := anonymousAudioEventType(settings.Status)
	payload := map[string]interface{}{
		"enabled":             settings.Enabled,
		"status":              settings.Status,
		"audio_mode":          settings.AudioMode,
		"language_mode":       settings.LanguageMode,
		"preferred_language":  settings.PreferredLanguage,
		"detected_language":   settings.DetectedLanguage,
		"language_confidence": settings.LanguageConfidence,
		"language_locked":     settings.LanguageLocked,
		"voice_template_id":   settings.VoiceTemplateID,
		"voice_template":      voiceTemplate.Slug,
		"worker_ready":        settings.WorkerReady,
		"worker_connected":    settings.WorkerConnected,
		"latency_ms":          settings.LatencyMs,
		"fallback_mode":       settings.FallbackMode,
		"last_error": map[string]string{
			"code":    settings.LastErrorCode,
			"message": settings.LastErrorMessage,
		},
		"updated_at": settings.UpdatedAt,
	}
	s.publish(code, eventType, payload)
}

func anonymousAudioEventType(status string) string {
	switch strings.TrimSpace(status) {
	case "initializing":
		return "anonymous_audio.initializing"
	case "ready":
		return "anonymous_audio.ready"
	case "listening":
		return "anonymous_audio.listening"
	case "recognizing":
		return "anonymous_audio.recognizing"
	case "synthesizing":
		return "anonymous_audio.synthesizing"
	case "playing":
		return "anonymous_audio.playing"
	case "error":
		return "anonymous_audio.error"
	default:
		return "anonymous_audio.stopped"
	}
}

func (s *Server) auditRequest(r *http.Request, sessionID int64, eventType, actorRole, actorToken string, details map[string]interface{}) {
	if sessionID == 0 {
		return
	}
	if details == nil {
		details = map[string]interface{}{}
	}
	details["path"] = r.URL.Path
	details["method"] = r.Method
	if err := s.store.AppendAuditEvent(
		r.Context(),
		sessionID,
		eventType,
		actorRole,
		maskToken(actorToken),
		clientIP(r),
		truncateString(r.UserAgent(), 240),
		details,
	); err != nil {
		log.Printf("append audit event failed: %v", err)
	}
}

func maskToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	if len(token) <= 8 {
		return token
	}
	return token[:4] + "..." + token[len(token)-4:]
}

func truncateString(v string, max int) string {
	v = strings.TrimSpace(v)
	if len(v) <= max {
		return v
	}
	return v[:max]
}

func normalizeMethodology(v string) string {
	v = strings.TrimSpace(strings.ToLower(v))
	switch v {
	case "brainwriting":
		return "brainwriting"
	case "swot":
		return "swot"
	case "start/stop/continue", "start-stop-continue", "start_stop_continue":
		return "start_stop_continue"
	case "anonymous q&a", "anonymous_q&a", "anonymous_qa", "anonymous qa":
		return "anonymous_qa"
	default:
		return v
	}
}

func isSupportedMethodology(v string) bool {
	_, ok := methodCategories[v]
	return ok
}

func categoriesFor(methodology string) []string {
	out := methodCategories[methodology]
	if len(out) == 0 {
		return []string{"general"}
	}
	return out
}

func isAllowedCategory(methodology, category string) bool {
	category = strings.TrimSpace(strings.ToLower(category))
	for _, c := range categoriesFor(methodology) {
		if strings.ToLower(c) == category {
			return true
		}
	}
	return false
}

var methodCategories = map[string][]string{
	"brainwriting":        {"ideas"},
	"swot":                {"strengths", "weaknesses", "opportunities", "threats"},
	"start_stop_continue": {"start", "stop", "continue"},
	"anonymous_qa":        {"questions", "answers"},
}

func hasFacilitatorAccess(r *http.Request, session model.Session) bool {
	if time.Now().After(session.FacilitatorTokenExpiresAt) {
		return false
	}
	actual := facilitatorTokenFromRequest(r)
	return actual != "" && actual == session.FacilitatorToken
}

func facilitatorTokenFromRequest(r *http.Request) string {
	return tokenFromRequest(r, "X-Facilitator-Token", "facilitator")
}

func participantTokenFromRequest(r *http.Request) string {
	return tokenFromRequest(r, "X-Participant-Token", "participant")
}

func tokenFromRequest(r *http.Request, headerName, role string) string {
	if r == nil {
		return ""
	}
	if token := strings.TrimSpace(r.Header.Get(headerName)); token != "" {
		return token
	}
	code := sessionCodeFromPath(r.URL.Path)
	if code == "" {
		return ""
	}
	cookie, err := r.Cookie(sessionTokenCookieName(role, code))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

func sessionCodeFromPath(path string) string {
	path = strings.TrimPrefix(strings.TrimSpace(path), "/api/sessions/")
	if path == "" {
		return ""
	}
	part := strings.Split(strings.Trim(path, "/"), "/")[0]
	return strings.ToUpper(strings.TrimSpace(part))
}

func sessionTokenCookieName(role, code string) string {
	return fmt.Sprintf("ghosttalk_%s_%s", strings.TrimSpace(role), strings.ToUpper(strings.TrimSpace(code)))
}

func setSessionTokenCookie(w http.ResponseWriter, role, code, token string, maxAge time.Duration, secure bool) {
	if strings.TrimSpace(code) == "" || strings.TrimSpace(token) == "" {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionTokenCookieName(role, code),
		Value:    token,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionTokenCookie(w http.ResponseWriter, role, code string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionTokenCookieName(role, code),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func joinCaptchaCookieName(code string) string {
	return fmt.Sprintf("ghosttalk_join_captcha_%s", strings.ToUpper(strings.TrimSpace(code)))
}

func setJoinCaptchaCookie(w http.ResponseWriter, code, answer string, maxAge time.Duration, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     joinCaptchaCookieName(code),
		Value:    answer,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearJoinCaptchaCookie(w http.ResponseWriter, code string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     joinCaptchaCookieName(code),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func validateJoinCaptcha(r *http.Request, code, answer string) bool {
	if strings.TrimSpace(answer) == "" {
		return false
	}
	cookie, err := r.Cookie(joinCaptchaCookieName(code))
	if err != nil {
		return false
	}
	return strings.TrimSpace(cookie.Value) == strings.TrimSpace(answer)
}

func randomIntInRange(min, max int) int {
	if max <= min {
		return min
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(max-min+1)))
	if err != nil {
		return min
	}
	return min + int(v.Int64())
}

func isSecureRequest(r *http.Request) bool {
	if r == nil {
		return false
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func (s *Server) exposeSession(session model.Session) map[string]interface{} {
	return map[string]interface{}{
		"id":                        session.ID,
		"code":                      session.Code,
		"title":                     session.Title,
		"description":               session.Description,
		"methodology":               session.Methodology,
		"video_room":                session.VideoRoom,
		"has_join_secret":           session.JoinSecret != "",
		"max_participants":          session.MaxParticipants,
		"video_enabled":             s.videoEnabled(),
		"anonymous_audio_available": s.anonymousAudioWorkerURL != "",
		"video_server_url":          s.livekitURL,
		"voting_open":               session.VotingOpen,
		"ended_at":                  session.EndedAt,
		"created_at":                session.CreatedAt,
	}
}

func buildVideoRoomName(code string) string {
	return fmt.Sprintf("ghosttalk-%s", strings.ToLower(strings.TrimSpace(code)))
}

func (s *Server) videoEnabled() bool {
	return isConfiguredLiveKitValue(s.livekitURL) && isConfiguredLiveKitValue(s.apiKey) && isConfiguredLiveKitValue(s.apiSecret)
}

func isConfiguredLiveKitValue(v string) bool {
	value := strings.TrimSpace(v)
	if value == "" {
		return false
	}
	lower := strings.ToLower(value)
	if strings.Contains(lower, "example.com") || strings.Contains(lower, "ghost-talk.example.com") {
		return false
	}
	switch lower {
	case "replace-me", "replace-with-generated-secret", "replace-with-strong-secret", "your-api-key", "your-api-secret", "wss://livekit.example.com", "wss://meet.example.com":
		return false
	}
	return true
}

func (s *Server) issueVideoToken(room, identity, displayName string, moderator bool, audioMode string) (string, error) {
	now := time.Now()
	metadata := map[string]interface{}{
		"display_name": displayName,
		"audio_mode":   normalizeAudioMode(audioMode),
	}
	metadataJSON, _ := json.Marshal(metadata)
	claims := livekitTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.apiKey,
			Subject:   identity,
			NotBefore: jwt.NewNumericDate(now.Add(-1 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(now.Add(2 * time.Hour)),
		},
		Video: livekitVideoGrant{
			Room:                 room,
			RoomJoin:             true,
			RoomAdmin:            moderator,
			CanPublish:           true,
			CanPublishData:       true,
			CanSubscribe:         true,
			CanUpdateOwnMetadata: true,
		},
		Metadata: string(metadataJSON),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.apiSecret))
}

func normalizeAudioMode(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "anonymous") {
		return "anonymous"
	}
	return "normal"
}

func normalizeLanguageMode(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "manual") {
		return "manual"
	}
	return "auto"
}

func normalizePreferredLanguage(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "uk-UA"
	}
	return v
}

func normalizeVoiceTemplateID(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "anonymous-neutral-01"
	}
	return v
}

func (s *Server) anonymousAudioWorkerReady(ctx context.Context) bool {
	if s.anonymousAudioWorkerURL == "" {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.anonymousAudioWorkerURL+"/ready", nil)
	if err != nil {
		return false
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return false
	}
	var out struct {
		Status    string `json:"status"`
		Livekit   bool   `json:"livekit"`
		Redis     bool   `json:"redis"`
		SttModel  bool   `json:"stt_model"`
		TtsEngine bool   `json:"tts_engine"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return false
	}
	return out.Status == "ready" && out.Livekit && out.Redis && out.SttModel && out.TtsEngine
}

func (s *Server) exposeAnonymousAudioStatus(settings model.AnonymousAudioSettings, voiceTemplate model.VoiceTemplate) map[string]interface{} {
	return map[string]interface{}{
		"enabled":             settings.Enabled,
		"status":              settings.Status,
		"audio_mode":          settings.AudioMode,
		"language_mode":       settings.LanguageMode,
		"preferred_language":  settings.PreferredLanguage,
		"detected_language":   settings.DetectedLanguage,
		"language_confidence": settings.LanguageConfidence,
		"language_locked":     settings.LanguageLocked,
		"voice_template_id":   settings.VoiceTemplateID,
		"voice_template":      voiceTemplate.Slug,
		"worker_ready":        settings.WorkerReady || s.anonymousAudioWorkerReady(context.Background()),
		"worker_connected":    settings.WorkerConnected,
		"latency_ms":          settings.LatencyMs,
		"fallback_mode":       settings.FallbackMode,
		"last_error": map[string]string{
			"code":    settings.LastErrorCode,
			"message": settings.LastErrorMessage,
		},
		"updated_at": settings.UpdatedAt,
	}
}

func normalizeDisplayName(v string) string {
	v = strings.TrimSpace(v)
	v = strings.Join(strings.Fields(v), " ")
	if len(v) > 60 {
		v = strings.TrimSpace(v[:60])
	}
	return v
}

type livekitTokenClaims struct {
	Video    livekitVideoGrant `json:"video"`
	Metadata string            `json:"metadata,omitempty"`
	jwt.RegisteredClaims
}

type livekitVideoGrant struct {
	Room                 string `json:"room,omitempty"`
	RoomJoin             bool   `json:"roomJoin,omitempty"`
	RoomAdmin            bool   `json:"roomAdmin,omitempty"`
	CanPublish           bool   `json:"canPublish,omitempty"`
	CanPublishData       bool   `json:"canPublishData,omitempty"`
	CanSubscribe         bool   `json:"canSubscribe,omitempty"`
	CanUpdateOwnMetadata bool   `json:"canUpdateOwnMetadata,omitempty"`
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" && s.isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept-Language, X-Participant-Token, X-Facilitator-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
		if r.Method == http.MethodOptions {
			if origin != "" && !s.isAllowedOrigin(origin) {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func normalizeAllowedOrigins(origins []string) map[string]struct{} {
	out := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin == "" {
			continue
		}
		out[origin] = struct{}{}
	}
	return out
}

func (s *Server) isAllowedOrigin(origin string) bool {
	if len(s.allowedOrigins) == 0 {
		return false
	}
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	_, ok := s.allowedOrigins[origin]
	return ok
}

func (s *Server) allowRequest(r *http.Request, bucket string, limit int, window time.Duration) bool {
	key := clientIP(r) + "|" + bucket
	return s.limiter.Allow(key, limit, window)
}

func clientIP(r *http.Request) string {
	if r == nil {
		return "unknown"
	}
	for _, candidate := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if addr, err := netip.ParseAddr(candidate); err == nil {
			return addr.String()
		}
	}
	host := strings.TrimSpace(r.RemoteAddr)
	if host == "" {
		return "unknown"
	}
	if addrPort, err := netip.ParseAddrPort(host); err == nil {
		return addrPort.Addr().String()
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.String()
	}
	return host
}

type rateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateLimitEntry
}

type rateLimitEntry struct {
	Count   int
	ResetAt time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{entries: make(map[string]rateLimitEntry)}
}

func (r *rateLimiter) Allow(key string, limit int, window time.Duration) bool {
	now := time.Now()

	r.mu.Lock()
	defer r.mu.Unlock()

	for existingKey, entry := range r.entries {
		if now.After(entry.ResetAt) {
			delete(r.entries, existingKey)
		}
	}

	entry, ok := r.entries[key]
	if !ok || now.After(entry.ResetAt) {
		r.entries[key] = rateLimitEntry{
			Count:   1,
			ResetAt: now.Add(window),
		}
		return true
	}
	if entry.Count >= limit {
		return false
	}
	entry.Count++
	r.entries[key] = entry
	return true
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, message string) {
	writeJSON(w, status, map[string]string{"error": localizedError(r, message)})
}

func localizedError(r *http.Request, message string) string {
	lang := "en"
	if r != nil {
		al := strings.ToLower(strings.TrimSpace(r.Header.Get("Accept-Language")))
		if strings.HasPrefix(al, "uk") {
			lang = "uk"
		}
	}
	if lang != "uk" {
		return message
	}
	if v, ok := errorUK[message]; ok {
		return v
	}
	return message
}

var errorUK = map[string]string{
	"method not allowed":                      "метод не дозволено",
	"invalid JSON":                            "некоректний JSON",
	"title required (1..120 chars)":           "назва обов'язкова (1..120 символів)",
	"description too long":                    "опис занадто довгий",
	"unsupported methodology":                 "непідтримувана методологія",
	"join secret too long":                    "секрет входу занадто довгий",
	"max participants too high":               "завеликий ліміт учасників",
	"failed to create session":                "не вдалося створити сесію",
	"not found":                               "не знайдено",
	"session not found":                       "сесію не знайдено",
	"failed to load session":                  "не вдалося завантажити сесію",
	"invalid facilitator token":               "некоректний токен фасилітатора",
	"failed to update session":                "не вдалося оновити сесію",
	"failed to join session":                  "не вдалося приєднатися до сесії",
	"invalid join secret":                     "некоректний секрет входу",
	"invalid captcha":                         "некоректна captcha",
	"session is full":                         "сесія вже заповнена",
	"failed to list cards":                    "не вдалося отримати картки",
	"text required (1..1000 chars)":           "текст обов'язковий (1..1000 символів)",
	"session already ended":                   "сесія вже завершена",
	"invalid category":                        "некоректна категорія",
	"missing participant token":               "відсутній токен учасника",
	"invalid participant token":               "некоректний токен учасника",
	"display name required":                   "потрібно вказати ім'я для відеокімнати",
	"failed to create card":                   "не вдалося створити картку",
	"invalid card id":                         "некоректний id картки",
	"participant already voted for this card": "учасник вже голосував за цю картку",
	"failed to vote card":                     "не вдалося проголосувати за картку",
	"card not found":                          "картку не знайдено",
	"failed to update card":                   "не вдалося оновити картку",
	"failed to load summary":                  "не вдалося завантажити підсумок",
	"failed to load top cards":                "не вдалося завантажити топ-картки",
	"failed to load audit events":             "не вдалося завантажити аудит",
	"invalid audit cursor":                    "некоректний курсор аудиту",
	"summary markdown too long":               "markdown підсумку занадто довгий",
	"failed to save summary":                  "не вдалося зберегти підсумок",
	"streaming unsupported":                   "потокова передача не підтримується",
	"transcription failed":                    "не вдалося розпізнати голос",
	"transcription service unavailable":       "сервіс розпізнавання тимчасово недоступний",
	"unsupported audio format":                "непідтримуваний формат аудіо",
	"invalid request body":                    "некоректне тіло запиту",
	"text is required":                        "потрібен текст",
	"synthesis failed":                        "не вдалося синтезувати голос",
	"synthesis service unavailable":           "сервіс синтезу голосу тимчасово недоступний",
	"unsupported voice or text":               "непідтримуваний голос або текст",
	"video service is not configured":         "відеосервіс не налаштований",
	"failed to create video token":            "не вдалося створити токен відеокімнати",
	"too many requests":                       "забагато запитів",
}

func WithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, d)
}
