package api

import (
	"bytes"
	"io"
	"net/http"
	"testing"

	"ghosttalk/backend/internal/model"
)

func TestNormalizeAudioMode(t *testing.T) {
	t.Parallel()

	if got := normalizeAudioMode("anonymous"); got != "anonymous" {
		t.Fatalf("normalizeAudioMode anonymous = %q", got)
	}
	if got := normalizeAudioMode(" anything "); got != "normal" {
		t.Fatalf("normalizeAudioMode fallback = %q", got)
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
	if !s.anonymousAudioWorkerReady(t.Context()) {
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
