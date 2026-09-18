package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"ghosttalk/backend/internal/api"
	"ghosttalk/backend/internal/realtime"
	"ghosttalk/backend/internal/store"
)

func main() {
	dsn := env("DATABASE_URL", "postgres://ghosttalk:ghosttalk@db:5432/ghosttalk?sslmode=disable")
	addr := env("ADDR", ":8080")
	whisperURL := env("WHISPER_URL", "http://whisper:8000")
	ttsURL := env("TTS_URL", "http://tts:8000")
	anonymousAudioWorkerURL := env("ANONYMOUS_AUDIO_WORKER_URL", "http://anonymous-audio-worker:8080")
	livekitURL := env("LIVEKIT_URL", "")
	livekitAPIKey := env("LIVEKIT_API_KEY", "")
	livekitAPISecret := env("LIVEKIT_API_SECRET", "")
	allowedOrigins := splitCSV(env("CORS_ALLOWED_ORIGINS", "http://localhost:13000,http://127.0.0.1:13000"))
	facilitatorTTL := durationEnv("FACILITATOR_TOKEN_TTL", 30*24*time.Hour)
	participantTTL := durationEnv("PARTICIPANT_TOKEN_TTL", 7*24*time.Hour)

	st, err := store.New(dsn, facilitatorTTL, participantTTL)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer st.Close()

	srv := api.New(st, realtime.NewHub(), whisperURL, ttsURL, anonymousAudioWorkerURL, livekitURL, livekitAPIKey, livekitAPISecret, facilitatorTTL, participantTTL, allowedOrigins)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      0,
	}
	log.Printf("GhostTalk backend listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server failed: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitCSV(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		out = append(out, part)
	}
	return out
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}
