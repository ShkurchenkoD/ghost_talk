package realtime

import (
	"sync"
)

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[chan []byte]subscriber
}

type subscriber struct {
	canReadPrivate bool
	participantID  int64
}

func NewHub() *Hub {
	return &Hub{clients: map[string]map[chan []byte]subscriber{}}
}

// Subscribe creates a session stream. Private events (transcript, analysis,
// and worker status) are delivered only to a facilitator stream. participantID
// is retained solely to address a participant's own transcript captions.
func (h *Hub) Subscribe(sessionCode string, canReadPrivate bool, participantID int64) chan []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan []byte, 8)
	if _, ok := h.clients[sessionCode]; !ok {
		h.clients[sessionCode] = map[chan []byte]subscriber{}
	}
	h.clients[sessionCode][ch] = subscriber{canReadPrivate: canReadPrivate, participantID: participantID}
	return ch
}

func (h *Hub) Unsubscribe(sessionCode string, ch chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if group, ok := h.clients[sessionCode]; ok {
		delete(group, ch)
		close(ch)
		if len(group) == 0 {
			delete(h.clients, sessionCode)
		}
	}
}

func (h *Hub) Broadcast(sessionCode, eventType string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	private := isPrivateEvent(eventType)
	for ch, subscriber := range h.clients[sessionCode] {
		if private && !subscriber.canReadPrivate {
			continue
		}
		select {
		case ch <- payload:
		default:
		}
	}
}

// BroadcastToParticipant sends a private event to facilitators and to exactly
// one participant. It is used for a speaker's own live captions; no other
// participant can observe their text.
func (h *Hub) BroadcastToParticipant(sessionCode string, participantID int64, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch, subscriber := range h.clients[sessionCode] {
		if !subscriber.canReadPrivate && subscriber.participantID != participantID {
			continue
		}
		select {
		case ch <- payload:
		default:
		}
	}
}

func isPrivateEvent(eventType string) bool {
	return eventType == "action_item_updated" ||
		len(eventType) >= len("transcript.") && eventType[:len("transcript.")] == "transcript." ||
		len(eventType) >= len("analysis.") && eventType[:len("analysis.")] == "analysis." ||
		len(eventType) >= len("anonymous_audio.") && eventType[:len("anonymous_audio.")] == "anonymous_audio."
}
