package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ghosttalk/backend/internal/model"
	"ghosttalk/backend/internal/realtime"
	"ghosttalk/backend/internal/store"
	"ghosttalk/backend/internal/util"
)

type Server struct {
	store *store.Store
	hub   *realtime.Hub
	mux   *http.ServeMux
}

func New(st *store.Store, hub *realtime.Hub) *Server {
	s := &Server{store: st, hub: hub, mux: http.NewServeMux()}
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
	s.mux.HandleFunc("/api/cards/", s.handleCardRoutes)
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var in struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Methodology string `json:"methodology"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid JSON")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.Methodology = normalizeMethodology(in.Methodology)
	if in.Title == "" || len(in.Title) > 120 {
		writeError(w, r, http.StatusBadRequest, "title required (1..120 chars)")
		return
	}
	if len(in.Description) > 1000 {
		writeError(w, r, http.StatusBadRequest, "description too long")
		return
	}
	if !isSupportedMethodology(in.Methodology) {
		writeError(w, r, http.StatusBadRequest, "unsupported methodology")
		return
	}
	ctx := r.Context()
	var session model.Session
	var err error
	for i := 0; i < 5; i++ {
		session, err = s.store.CreateSession(ctx, in.Title, in.Description, in.Methodology, util.NewCode(6), util.NewToken(24))
		if err == nil {
			break
		}
	}
	if err != nil {
		log.Printf("create session: %v", err)
		writeError(w, r, http.StatusInternalServerError, "failed to create session")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"session":             exposeSession(session),
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
	case "cards":
		s.handleSessionCards(w, r, code)
	case "summary":
		s.handleSummary(w, r, code)
	case "events":
		s.handleEvents(w, r, code)
	default:
		writeError(w, r, http.StatusNotFound, "not found")
	}
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
			"session":     exposeSession(session),
			"categories":  categoriesFor(session.Methodology),
			"methodology": session.Methodology,
		})
	case http.MethodPatch:
		if !hasFacilitatorAccess(r, session.FacilitatorToken) {
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
		s.publish(code, "session_updated", exposeSession(updated))
		writeJSON(w, http.StatusOK, map[string]interface{}{"session": exposeSession(updated)})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodPost {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	session, err := s.store.GetSessionByCode(r.Context(), code)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "session not found")
		return
	}
	participant, err := s.store.CreateParticipant(r.Context(), code, util.NewToken(24))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "failed to join session")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"participant_token": participant.Token,
		"session":           exposeSession(session),
		"categories":        categoriesFor(session.Methodology),
	})
}

func (s *Server) handleSessionCards(w http.ResponseWriter, r *http.Request, code string) {
	switch r.Method {
	case http.MethodGet:
		includeHidden := r.URL.Query().Get("include_hidden") == "1"
		if includeHidden {
			session, err := s.store.GetSessionByCode(r.Context(), code)
			if err != nil || !hasFacilitatorAccess(r, session.FacilitatorToken) {
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
		var in struct {
			Text     string `json:"text"`
			Category string `json:"category"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid JSON")
			return
		}
		in.Text = strings.TrimSpace(in.Text)
		if in.Text == "" || len(in.Text) > 1000 {
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
		participantToken := r.Header.Get("X-Participant-Token")
		if participantToken == "" {
			writeError(w, r, http.StatusUnauthorized, "missing participant token")
			return
		}
		card, err := s.store.CreateCard(r.Context(), code, participantToken, in.Text, in.Category)
		if err != nil {
			writeError(w, r, http.StatusBadRequest, "failed to create card")
			return
		}
		s.publish(code, "card_created", card)
		writeJSON(w, http.StatusCreated, map[string]interface{}{"card": card})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
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
	participantToken := r.Header.Get("X-Participant-Token")
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
	if err != nil || !hasFacilitatorAccess(r, session.FacilitatorToken) {
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
		if t == "" || len(t) > 1000 {
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
			"session":   exposeSession(session),
		})
	case http.MethodPost:
		if !hasFacilitatorAccess(r, session.FacilitatorToken) {
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
		s.publish(code, "summary_updated", summary)
		writeJSON(w, http.StatusOK, map[string]interface{}{"summary": summary})
	default:
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, code string) {
	if r.Method != http.MethodGet {
		writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
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

func (s *Server) publish(code, eventType string, payload interface{}) {
	data, err := json.Marshal(model.Event{Type: eventType, Payload: payload})
	if err != nil {
		return
	}
	s.hub.Broadcast(code, data)
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

func hasFacilitatorAccess(r *http.Request, expected string) bool {
	actual := strings.TrimSpace(r.Header.Get("X-Facilitator-Token"))
	return actual != "" && actual == expected
}

func exposeSession(s model.Session) map[string]interface{} {
	return map[string]interface{}{
		"id":          s.ID,
		"code":        s.Code,
		"title":       s.Title,
		"description": s.Description,
		"methodology": s.Methodology,
		"voting_open": s.VotingOpen,
		"ended_at":    s.EndedAt,
		"created_at":  s.CreatedAt,
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Participant-Token, X-Facilitator-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
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
	"failed to create session":                "не вдалося створити сесію",
	"not found":                               "не знайдено",
	"session not found":                       "сесію не знайдено",
	"failed to load session":                  "не вдалося завантажити сесію",
	"invalid facilitator token":               "некоректний токен фасилітатора",
	"failed to update session":                "не вдалося оновити сесію",
	"failed to join session":                  "не вдалося приєднатися до сесії",
	"failed to list cards":                    "не вдалося отримати картки",
	"text required (1..1000 chars)":           "текст обов'язковий (1..1000 символів)",
	"session already ended":                   "сесія вже завершена",
	"invalid category":                        "некоректна категорія",
	"missing participant token":               "відсутній токен учасника",
	"failed to create card":                   "не вдалося створити картку",
	"invalid card id":                         "некоректний id картки",
	"participant already voted for this card": "учасник вже голосував за цю картку",
	"failed to vote card":                     "не вдалося проголосувати за картку",
	"card not found":                          "картку не знайдено",
	"failed to update card":                   "не вдалося оновити картку",
	"failed to load summary":                  "не вдалося завантажити підсумок",
	"failed to load top cards":                "не вдалося завантажити топ-картки",
	"summary markdown too long":               "markdown підсумку занадто довгий",
	"failed to save summary":                  "не вдалося зберегти підсумок",
	"streaming unsupported":                   "потокова передача не підтримується",
}

func WithTimeout(parent context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, d)
}
