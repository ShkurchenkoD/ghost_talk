package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"ghosttalk/backend/internal/api"
	"ghosttalk/backend/internal/realtime"
	"ghosttalk/backend/internal/store"
)

func main() {
	dsn := env("DATABASE_URL", "postgres://ghosttalk:ghosttalk@db:5432/ghosttalk?sslmode=disable")
	addr := env("ADDR", ":8080")

	st, err := store.New(dsn)
	if err != nil {
		log.Fatalf("db connect failed: %v", err)
	}
	defer st.Close()

	srv := api.New(st, realtime.NewHub())
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
