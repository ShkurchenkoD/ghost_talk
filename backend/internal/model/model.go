package model

import "time"

type Session struct {
	ID               int64      `json:"id"`
	Code             string     `json:"code"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Methodology      string     `json:"methodology"`
	FacilitatorToken string     `json:"facilitator_token,omitempty"`
	VotingOpen       bool       `json:"voting_open"`
	EndedAt          *time.Time `json:"ended_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

type Participant struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	Token     string    `json:"token"`
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
