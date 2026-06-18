# GhostTalk PoC

Proof-of-Concept web app for structured anonymous facilitation sessions.

## Stack

- Frontend: React + Vite
- Backend: Go (`net/http`) + SSE realtime
- Database: PostgreSQL
- Realtime: Server-Sent Events (`/api/sessions/:code/events`)
- Voice input: mocked transcription prompt (no voice file storage)

## Features Implemented

- Facilitator creates session with methodology
- Join code and link generation
- Anonymous participant join (token-based, no registration)
- Anonymous card submission (text + mock voice input)
- Realtime card updates (create, vote, hide, move, session state)
- Voting with duplicate-vote prevention per participant token
- Facilitator controls:
  - hide/unhide cards
  - move cards between categories
  - start/stop voting
  - end session
  - create/edit final summary
- Summary page with top voted cards and Markdown export

## Project Structure

- `backend/` Go API server
- `frontend/` React app
- `db/migrations/001_init.sql` PostgreSQL schema
- `docker-compose.yml` local run setup

## Run Locally (Docker Compose)

```bash
docker compose up --build
```

Apps:

- Frontend: `http://localhost:13000`
- Backend API: `http://localhost:18080`
- PostgreSQL: `localhost:55432` (`ghosttalk/ghosttalk`)

You can override host ports without editing files:

```bash
HOST_FRONTEND_PORT=13001 HOST_BACKEND_PORT=18081 HOST_DB_PORT=55433 docker compose up --build
```

## Demo Flow

1. Open `http://localhost:13000`.
2. Click **Create Session**.
3. Fill title/description/methodology.
4. On facilitator dashboard, copy join code.
5. Open a second browser/incognito, join via `/session/:code`.
6. Submit anonymous cards and votes.
7. On facilitator dashboard:
   - hide/unhide or move cards
   - start/stop voting
   - end session
   - save summary notes
8. Open `/summary/:code` and click **Export Markdown**.

## API Endpoints

- `POST /api/sessions`
- `GET /api/sessions/:code`
- `PATCH /api/sessions/:code`
- `POST /api/sessions/:code/join`
- `POST /api/sessions/:code/cards`
- `GET /api/sessions/:code/cards`
- `POST /api/cards/:id/vote`
- `PATCH /api/cards/:id`
- `POST /api/sessions/:code/summary`
- `GET /api/sessions/:code/summary`
- `GET /api/sessions/:code/events` (SSE)

## Privacy Notes (PoC)

- Participant identity is anonymous to other participants.
- No participant names are displayed.
- No raw voice files are stored (mock text transcription only).
- Basic input validation is enforced server-side.
