package api

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"ghosttalk/backend/internal/model"
	"github.com/golang-jwt/jwt/v5"
)

func TestLocalizedAnalysisWorkerUnavailable(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Accept-Language", "uk-UA")
	if got := localizedError(req, "analysis worker unavailable"); got != "сервіс формування висновків тимчасово недоступний" {
		t.Fatalf("localized error = %q", got)
	}
}

func TestNormalizeAudioMode(t *testing.T) {
	t.Parallel()

	if got := normalizeAudioMode("anonymous"); got != "anonymous" {
		t.Fatalf("normalizeAudioMode anonymous = %q", got)
	}
	if got := normalizeAudioMode(" anything "); got != "normal" {
		t.Fatalf("normalizeAudioMode fallback = %q", got)
	}
	if got := normalizeAudioMode("masked"); got != "masked" {
		t.Fatalf("normalizeAudioMode masked = %q", got)
	}
}

func TestAnonymousAudioWorkerRequirement(t *testing.T) {
	t.Parallel()
	if !requiresAnonymousAudioWorker(true, "anonymous") {
		t.Fatal("anonymous mode must require the synthetic audio worker")
	}
	if requiresAnonymousAudioWorker(true, "masked") {
		t.Fatal("masked mode must be served by media-worker, not synthetic worker")
	}
	if requiresAnonymousAudioWorker(false, "anonymous") {
		t.Fatal("disabled anonymity must not require a worker")
	}
}

func TestInternalWorkerRoutesRequireSharedToken(t *testing.T) {
	t.Parallel()

	s := &Server{internalWorkerToken: "worker-secret", httpClient: http.DefaultClient}
	for _, route := range []string{"/api/internal/transcribe", "/api/internal/synthesize"} {
		t.Run(route, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, route, bytes.NewBufferString(`{}`))
			rec := httptest.NewRecorder()
			if route == "/api/internal/transcribe" {
				s.handleInternalTranscribe(rec, req)
			} else {
				s.handleInternalSynthesize(rec, req)
			}
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status without worker token = %d, want %d", rec.Code, http.StatusUnauthorized)
			}

			req = httptest.NewRequest(http.MethodPost, route, bytes.NewBufferString(`{}`))
			req.Header.Set("X-Internal-Worker-Token", "wrong-token")
			rec = httptest.NewRecorder()
			if route == "/api/internal/transcribe" {
				s.handleInternalTranscribe(rec, req)
			} else {
				s.handleInternalSynthesize(rec, req)
			}
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status with wrong worker token = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestMediaTopologyAndRoomNames(t *testing.T) {
	t.Parallel()
	if got := normalizeMediaTopology("DUAL"); got != "dual" {
		t.Fatalf("normalizeMediaTopology dual = %q", got)
	}
	if got := normalizeMediaTopology("unknown"); got != "single" {
		t.Fatalf("normalizeMediaTopology fallback = %q", got)
	}
	if got := buildInputRoomName(" AbC12 "); got != "ghosttalk-abc12-input" {
		t.Fatalf("buildInputRoomName = %q", got)
	}
}

func TestIssueVideoTokenDualRoomPublishIsolation(t *testing.T) {
	t.Parallel()

	s := &Server{apiKey: "test-key", apiSecret: "test-secret"}
	tests := []struct {
		name             string
		room             string
		identity         string
		audioMode        string
		moderator        bool
		canPublish       bool
		publishSources   []string
		canSubscribe     bool
		wantRoom         string
		wantCanPublish   bool
		wantCanSubscribe bool
		wantSources      []string
	}{
		{
			name: "anonymous public is camera only",
			room: "ghosttalk-abcd1", identity: "participant-1", audioMode: "anonymous",
			canPublish: true, publishSources: []string{"camera"}, canSubscribe: true,
			wantRoom: "ghosttalk-abcd1", wantCanPublish: true, wantCanSubscribe: true,
			wantSources: []string{"camera"},
		},
		{
			name: "masked public is camera only",
			room: "ghosttalk-abcd1", identity: "participant-1", audioMode: "masked",
			canPublish: true, publishSources: []string{"camera"}, canSubscribe: true,
			wantRoom: "ghosttalk-abcd1", wantCanPublish: true, wantCanSubscribe: true,
			wantSources: []string{"camera"},
		},
		{
			name: "normal public can publish camera and microphone",
			room: "ghosttalk-abcd1", identity: "participant-1", audioMode: "normal",
			canPublish: true, publishSources: []string{"camera", "microphone"}, canSubscribe: true,
			wantRoom: "ghosttalk-abcd1", wantCanPublish: true, wantCanSubscribe: true,
			wantSources: []string{"camera", "microphone"},
		},
		{
			name: "dual input publishes microphone without subscribing",
			room: "ghosttalk-abcd1-input", identity: "participant-1", audioMode: "anonymous",
			canPublish: true, publishSources: []string{"microphone"}, canSubscribe: false,
			wantRoom: "ghosttalk-abcd1-input", wantCanPublish: true, wantCanSubscribe: false,
			wantSources: []string{"microphone"},
		},
		{
			name: "single topology normal token remains unrestricted",
			room: "ghosttalk-abcd1", identity: "participant-1", audioMode: "normal",
			canPublish: true, publishSources: nil, canSubscribe: true,
			wantRoom: "ghosttalk-abcd1", wantCanPublish: true, wantCanSubscribe: true,
			wantSources: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tokenString, err := s.issueVideoToken(tt.room, tt.identity, "Participant", tt.moderator, tt.audioMode, tt.canPublish, tt.publishSources, tt.canSubscribe)
			if err != nil {
				t.Fatalf("issueVideoToken() error = %v", err)
			}
			claims := &livekitTokenClaims{}
			parsed, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
				if token.Method != jwt.SigningMethodHS256 {
					t.Fatalf("signing method = %v, want HS256", token.Method)
				}
				return []byte(s.apiSecret), nil
			})
			if err != nil || !parsed.Valid {
				t.Fatalf("parse token: valid=%v err=%v", parsed.Valid, err)
			}
			if claims.Video.Room != tt.wantRoom {
				t.Fatalf("room = %q, want %q", claims.Video.Room, tt.wantRoom)
			}
			if claims.Video.CanPublish != tt.wantCanPublish {
				t.Fatalf("canPublish = %v, want %v", claims.Video.CanPublish, tt.wantCanPublish)
			}
			if claims.Video.CanSubscribe != tt.wantCanSubscribe {
				t.Fatalf("canSubscribe = %v, want %v", claims.Video.CanSubscribe, tt.wantCanSubscribe)
			}
			if !equalStrings(claims.Video.CanPublishSources, tt.wantSources) {
				t.Fatalf("canPublishSources = %#v, want %#v", claims.Video.CanPublishSources, tt.wantSources)
			}
		})
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRedactTranscriptPII(t *testing.T) {
	t.Parallel()

	input := "Напишіть на person@example.org або телефонуйте +380 50 123 45 67."
	got, changed := redactTranscriptPII(input)
	if !changed {
		t.Fatal("redactTranscriptPII did not report a change")
	}
	if got != "Напишіть на [redacted-email] або телефонуйте [redacted-phone]." {
		t.Fatalf("redactTranscriptPII = %q", got)
	}

	unchanged, changed := redactTranscriptPII("Обговоримо дорожню карту завтра.")
	if changed || unchanged != "Обговоримо дорожню карту завтра." {
		t.Fatalf("non-PII transcript changed: %q, changed=%v", unchanged, changed)
	}
}

func TestNormalizeLanguageMode(t *testing.T) {
	t.Parallel()

	if got := normalizeLanguageMode("manual"); got != "manual" {
		t.Fatalf("normalizeLanguageMode manual = %q", got)
	}
	if got := normalizeLanguageMode(""); got != "auto" {
		t.Fatalf("normalizeLanguageMode default = %q", got)
	}
}

func TestNormalizePreferredLanguage(t *testing.T) {
	t.Parallel()

	if got := normalizePreferredLanguage(""); got != "uk-UA" {
		t.Fatalf("normalizePreferredLanguage default = %q", got)
	}
	if got := normalizePreferredLanguage("en-US"); got != "en-US" {
		t.Fatalf("normalizePreferredLanguage explicit = %q", got)
	}
}

func TestIsConfiguredLiveKitValue(t *testing.T) {
	t.Parallel()

	valid := []string{
		"wss://meet.ghost-talk.online",
		"ghosttalk-prod",
		"super-secret-value",
	}
	for _, value := range valid {
		if !isConfiguredLiveKitValue(value) {
			t.Fatalf("isConfiguredLiveKitValue(%q) = false, want true", value)
		}
	}

	invalid := []string{
		"",
		"   ",
		"replace-me",
		"replace-with-generated-secret",
		"replace-with-strong-secret",
		"your-api-key",
		"your-api-secret",
		"wss://livekit.example.com",
		"wss://meet.example.com",
		"https://ghost-talk.example.com",
	}
	for _, value := range invalid {
		if isConfiguredLiveKitValue(value) {
			t.Fatalf("isConfiguredLiveKitValue(%q) = true, want false", value)
		}
	}
}

func TestAnonymousAudioWorkerReady(t *testing.T) {
	t.Parallel()

	s := &Server{
		anonymousAudioWorkerURL: "http://anonymous-audio-worker",
		httpClient: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/ready" {
					return &http.Response{
						StatusCode: http.StatusNotFound,
						Body:       io.NopCloser(bytes.NewBufferString(`{}`)),
						Header:     make(http.Header),
					}, nil
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Body: io.NopCloser(bytes.NewBufferString(`{
						"status":"ready",
						"livekit":true,
						"redis":true,
						"stt_model":true,
						"tts_engine":true
					}`)),
					Header: make(http.Header),
				}, nil
			}),
		},
	}
	if !s.anonymousAudioWorkerReady(context.Background()) {
		t.Fatal("anonymousAudioWorkerReady = false, want true")
	}
}

func TestExposeAnonymousAudioStatus(t *testing.T) {
	t.Parallel()

	s := &Server{}
	status := s.exposeAnonymousAudioStatus(model.AnonymousAudioSettings{
		Enabled:            true,
		Status:             "ready",
		AudioMode:          "anonymous",
		LanguageMode:       "auto",
		PreferredLanguage:  "uk-UA",
		DetectedLanguage:   "uk",
		LanguageConfidence: 0.91,
		VoiceTemplateID:    "anonymous-neutral-01",
		WorkerReady:        true,
		WorkerConnected:    true,
		LatencyMs:          1450,
		FallbackMode:       "mute",
		LastErrorCode:      "",
		LastErrorMessage:   "",
	}, model.VoiceTemplate{
		ID:   "anonymous-neutral-01",
		Slug: "anonymous-neutral-01",
	})

	if got := status["audio_mode"]; got != "anonymous" {
		t.Fatalf("audio_mode = %v", got)
	}
	lastError, ok := status["last_error"].(map[string]string)
	if !ok {
		t.Fatalf("last_error type = %T", status["last_error"])
	}
	if lastError["code"] != "" || lastError["message"] != "" {
		t.Fatalf("last_error = %#v", lastError)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
