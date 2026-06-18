package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq"

	"ghosttalk/backend/internal/model"
)

var ErrNotFound = errors.New("not found")
var ErrDuplicateVote = errors.New("duplicate vote")

type Store struct {
	db *sql.DB
}

func New(dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(15)
	db.SetMaxIdleConns(15)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) CreateSession(ctx context.Context, title, description, methodology, code, facilitatorToken string) (model.Session, error) {
	var out model.Session
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO sessions (code, title, description, methodology, facilitator_token)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, code, title, description, methodology, facilitator_token, voting_open, ended_at, created_at
	`, code, title, description, methodology, facilitatorToken).Scan(
		&out.ID, &out.Code, &out.Title, &out.Description, &out.Methodology,
		&out.FacilitatorToken, &out.VotingOpen, &out.EndedAt, &out.CreatedAt,
	)
	return out, err
}

func (s *Store) GetSessionByCode(ctx context.Context, code string) (model.Session, error) {
	var out model.Session
	err := s.db.QueryRowContext(ctx, `
		SELECT id, code, title, description, methodology, facilitator_token, voting_open, ended_at, created_at
		FROM sessions WHERE code = $1
	`, strings.ToUpper(code)).Scan(
		&out.ID, &out.Code, &out.Title, &out.Description, &out.Methodology,
		&out.FacilitatorToken, &out.VotingOpen, &out.EndedAt, &out.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) CreateParticipant(ctx context.Context, sessionCode, token string) (model.Participant, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.Participant{}, err
	}
	var out model.Participant
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO participants (session_id, token)
		VALUES ($1,$2)
		RETURNING id, session_id, token, created_at
	`, session.ID, token).Scan(&out.ID, &out.SessionID, &out.Token, &out.CreatedAt)
	return out, err
}

func (s *Store) FindParticipantByToken(ctx context.Context, token string) (model.Participant, error) {
	var out model.Participant
	err := s.db.QueryRowContext(ctx, `SELECT id, session_id, token, created_at FROM participants WHERE token = $1`, token).
		Scan(&out.ID, &out.SessionID, &out.Token, &out.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) CreateCard(ctx context.Context, sessionCode, participantToken, text, category string) (model.Card, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.Card{}, err
	}
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return model.Card{}, err
	}
	if participant.SessionID != session.ID {
		return model.Card{}, fmt.Errorf("participant not in session")
	}
	var out model.Card
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO cards (session_id, participant_id, text, category)
		VALUES ($1,$2,$3,$4)
		RETURNING id, session_id, text, category, vote_count, hidden, created_at
	`, session.ID, participant.ID, text, category).Scan(
		&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt,
	)
	return out, err
}

func (s *Store) ListCards(ctx context.Context, sessionCode string, includeHidden bool) ([]model.Card, error) {
	session, err := s.GetSessionByCode(ctx, sessionCode)
	if err != nil {
		return nil, err
	}
	query := `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards
		WHERE session_id = $1
	`
	if !includeHidden {
		query += ` AND hidden = false`
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, query, session.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]model.Card, 0)
	for rows.Next() {
		var c model.Card
		if err := rows.Scan(&c.ID, &c.SessionID, &c.Text, &c.Category, &c.VoteCount, &c.Hidden, &c.CreatedAt); err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

func (s *Store) VoteCard(ctx context.Context, cardID int64, participantToken string) (model.Card, error) {
	participant, err := s.FindParticipantByToken(ctx, participantToken)
	if err != nil {
		return model.Card{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.Card{}, err
	}
	defer tx.Rollback()

	var sessionID int64
	err = tx.QueryRowContext(ctx, `SELECT session_id FROM cards WHERE id = $1`, cardID).Scan(&sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Card{}, ErrNotFound
	}
	if err != nil {
		return model.Card{}, err
	}
	if participant.SessionID != sessionID {
		return model.Card{}, fmt.Errorf("participant not in session")
	}
	var votingOpen bool
	var endedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT voting_open, ended_at FROM sessions WHERE id = $1`, sessionID).Scan(&votingOpen, &endedAt)
	if err != nil {
		return model.Card{}, err
	}
	if !votingOpen || endedAt.Valid {
		return model.Card{}, fmt.Errorf("voting is closed")
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO votes(card_id, participant_id) VALUES ($1,$2)`, cardID, participant.ID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return model.Card{}, ErrDuplicateVote
		}
		return model.Card{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE cards SET vote_count = vote_count + 1, updated_at = NOW() WHERE id = $1`, cardID)
	if err != nil {
		return model.Card{}, err
	}
	var out model.Card
	err = tx.QueryRowContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards WHERE id = $1
	`, cardID).Scan(&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt)
	if err != nil {
		return model.Card{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.Card{}, err
	}
	return out, nil
}

func (s *Store) UpdateCard(ctx context.Context, cardID int64, hidden *bool, category *string, text *string) (model.Card, error) {
	set := make([]string, 0, 4)
	args := make([]interface{}, 0, 4)
	argPos := 1
	if hidden != nil {
		set = append(set, fmt.Sprintf("hidden = $%d", argPos))
		args = append(args, *hidden)
		argPos++
	}
	if category != nil {
		set = append(set, fmt.Sprintf("category = $%d", argPos))
		args = append(args, *category)
		argPos++
	}
	if text != nil {
		set = append(set, fmt.Sprintf("text = $%d", argPos))
		args = append(args, *text)
		argPos++
	}
	if len(set) == 0 {
		return s.GetCard(ctx, cardID)
	}
	set = append(set, "updated_at = NOW()")
	query := fmt.Sprintf("UPDATE cards SET %s WHERE id = $%d", strings.Join(set, ","), argPos)
	args = append(args, cardID)
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return model.Card{}, err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return model.Card{}, ErrNotFound
	}
	return s.GetCard(ctx, cardID)
}

func (s *Store) GetCard(ctx context.Context, cardID int64) (model.Card, error) {
	var out model.Card
	err := s.db.QueryRowContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards WHERE id = $1
	`, cardID).Scan(&out.ID, &out.SessionID, &out.Text, &out.Category, &out.VoteCount, &out.Hidden, &out.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) UpdateSessionState(ctx context.Context, code string, votingOpen *bool, endSession bool) (model.Session, error) {
	parts := []string{}
	args := []interface{}{}
	argPos := 1
	if votingOpen != nil {
		parts = append(parts, fmt.Sprintf("voting_open = $%d", argPos))
		args = append(args, *votingOpen)
		argPos++
	}
	if endSession {
		parts = append(parts, "ended_at = NOW()")
	}
	if len(parts) > 0 {
		query := fmt.Sprintf("UPDATE sessions SET %s, updated_at = NOW() WHERE code = $%d", strings.Join(parts, ","), argPos)
		args = append(args, strings.ToUpper(code))
		res, err := s.db.ExecContext(ctx, query, args...)
		if err != nil {
			return model.Session{}, err
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return model.Session{}, ErrNotFound
		}
	}
	return s.GetSessionByCode(ctx, code)
}

func (s *Store) UpsertSummary(ctx context.Context, code, markdown, grouped, risks, actions string) (model.Summary, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return model.Summary{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO summaries(session_id, markdown, grouped_thoughts, risks_questions, action_items)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT(session_id) DO UPDATE SET
			markdown = EXCLUDED.markdown,
			grouped_thoughts = EXCLUDED.grouped_thoughts,
			risks_questions = EXCLUDED.risks_questions,
			action_items = EXCLUDED.action_items,
			updated_at = NOW()
	`, session.ID, markdown, grouped, risks, actions)
	if err != nil {
		return model.Summary{}, err
	}
	return s.GetSummary(ctx, code)
}

func (s *Store) GetSummary(ctx context.Context, code string) (model.Summary, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return model.Summary{}, err
	}
	var out model.Summary
	err = s.db.QueryRowContext(ctx, `
		SELECT s.session_id, sess.code, s.markdown, s.grouped_thoughts, s.risks_questions, s.action_items, s.updated_at
		FROM summaries s
		JOIN sessions sess ON sess.id = s.session_id
		WHERE s.session_id = $1
	`, session.ID).Scan(
		&out.SessionID, &out.Code, &out.Markdown, &out.GroupedThought,
		&out.RisksQuestions, &out.ActionItems, &out.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

func (s *Store) GetTopCards(ctx context.Context, code string, limit int) ([]model.Card, error) {
	session, err := s.GetSessionByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, text, category, vote_count, hidden, created_at
		FROM cards
		WHERE session_id = $1 AND hidden = false
		ORDER BY vote_count DESC, created_at ASC
		LIMIT $2
	`, session.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := []model.Card{}
	for rows.Next() {
		var c model.Card
		if err := rows.Scan(&c.ID, &c.SessionID, &c.Text, &c.Category, &c.VoteCount, &c.Hidden, &c.CreatedAt); err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

func (s *Store) GetSessionCodeByID(ctx context.Context, sessionID int64) (string, error) {
	var code string
	err := s.db.QueryRowContext(ctx, `SELECT code FROM sessions WHERE id = $1`, sessionID).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return code, err
}
