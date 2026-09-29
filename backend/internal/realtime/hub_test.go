package realtime

import "testing"

func mustReceive(t *testing.T, ch <-chan []byte, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if string(got) != want {
			t.Fatalf("event = %q, want %q", got, want)
		}
	default:
		t.Fatalf("expected event %q", want)
	}
}

func mustNotReceive(t *testing.T, ch <-chan []byte) {
	t.Helper()
	select {
	case got := <-ch:
		t.Fatalf("unexpected event %q", got)
	default:
	}
}

func TestPrivateTranscriptEventsReachOnlyFacilitator(t *testing.T) {
	hub := NewHub()
	facilitator := hub.Subscribe("ABC123", true, 0)
	participant := hub.Subscribe("ABC123", false, 17)
	t.Cleanup(func() {
		hub.Unsubscribe("ABC123", facilitator)
		hub.Unsubscribe("ABC123", participant)
	})

	hub.Broadcast("ABC123", "transcript.segment.final", []byte("private"))

	mustReceive(t, facilitator, "private")
	mustNotReceive(t, participant)
}

func TestCaptionReachesOnlyItsSpeakerAndFacilitator(t *testing.T) {
	hub := NewHub()
	facilitator := hub.Subscribe("ABC123", true, 0)
	speaker := hub.Subscribe("ABC123", false, 17)
	otherParticipant := hub.Subscribe("ABC123", false, 23)
	t.Cleanup(func() {
		hub.Unsubscribe("ABC123", facilitator)
		hub.Unsubscribe("ABC123", speaker)
		hub.Unsubscribe("ABC123", otherParticipant)
	})

	hub.BroadcastToParticipant("ABC123", 17, []byte("caption"))

	mustReceive(t, facilitator, "caption")
	mustReceive(t, speaker, "caption")
	mustNotReceive(t, otherParticipant)
}
