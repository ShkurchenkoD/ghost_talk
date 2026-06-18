package realtime

import (
	"sync"
)

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[chan []byte]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: map[string]map[chan []byte]struct{}{}}
}

func (h *Hub) Subscribe(sessionCode string) chan []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan []byte, 8)
	if _, ok := h.clients[sessionCode]; !ok {
		h.clients[sessionCode] = map[chan []byte]struct{}{}
	}
	h.clients[sessionCode][ch] = struct{}{}
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

func (h *Hub) Broadcast(sessionCode string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients[sessionCode] {
		select {
		case ch <- payload:
		default:
		}
	}
}
