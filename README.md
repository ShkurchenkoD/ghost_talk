# GhostTalk PoC

GhostTalk — self-hosted вебплатформа для структурованих анонімних командних
сесій. Вона допомагає збирати чесні думки, проводити голосування в реальному
часі, безпечно спілкуватися у відеокімнаті та перетворювати розмову на
перевірений протокол, висновки й action items.

## Stack

- Frontend: React + Vite
- Backend: Go (`net/http`) + SSE realtime
- Database: PostgreSQL
- Realtime: Server-Sent Events (`/api/sessions/:code/events`)
- Voice input: mocked transcription prompt (no voice file storage)
- Video rooms: embedded LiveKit rooms via `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`
- Anonymous audio mode: backend-controlled safe mode with `mute` fallback, readiness worker, and consent-gated `media-worker` transcription

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
- LiveKit video rooms with browser avatar, blur/pixelation and anonymous voice
  modes
- Privacy-safe dual-room media topology with worker readiness and mute fallback
- Consent-gated live captions and pseudonymous timestamped transcript segments
- PII-redaction, transcript filters, facilitator editing with audit trail
- Markdown/JSON transcript export, analysis jobs, insights and action items

## Як працює захист медіа та протокол розмови

### Dual-room архітектура LiveKit

В анонімних режимах `masked` і `synthetic` учасник підключається до двох
логічно ізольованих LiveKit-кімнат:

```text
Учасник ── raw-мікрофон ──► input room ──► media worker
                                      │
                                      └─ оброблений голос ──► public room
```

- `input room` доступна лише учаснику та media-worker і містить оригінальний
  аудіотрек;
- media-worker застосовує voice masking або конвеєр STT → PII-redaction → TTS;
- у `public room` усі учасники отримують тільки оброблений аудіотрек;
- LiveKit-токени забороняють анонімному учаснику публікувати raw-мікрофон у
  public room;
- raw-аудіо та raw-відео не записуються за замовчуванням.

У режимі `normal`, коли анонімізацію явно вимкнено, мікрофон публікується
напряму в public room — це очікувана поведінка звичайного відеодзвінка.

### Live captions і текстовий протокол

Після згоди учасника система перетворює мовлення на текст. Проміжні фрази
передаються як live captions через SSE і можуть змінюватися під час мовлення.
Після завершення фрази створюється фінальний сегмент, який проходить
PII-redaction і зберігається у протоколі.

Кожен сегмент містить лише сесійний псевдонім (наприклад, «Учасник 3»),
таймкоди початку й завершення, мову, confidence та статус редагування.
Фасилітатор може фільтрувати протокол за учасником, мовою і часом, виправляти
текст із журналюванням аудиту та експортувати результат у Markdown або JSON.
Фоновий analysis-worker використовує фінальні сегменти для формування тем,
рішень, ризиків і action items.

## Project Structure

- `backend/` Go API server
- `frontend/` React app
- `db/migrations/001_init.sql` PostgreSQL schema
- `docker-compose.yml` local run setup
- `anonymous-audio-worker/` worker readiness/runtime-status service
- `media-worker/` consent-gated LiveKit worker: subscribes only to the private input room, creates transcript segments, and publishes only processed `anonymous`/`masked` audio into the public room

## Run Locally (Docker Compose)

```bash
docker compose up --build
```

### GPU transcription

On a host with NVIDIA Container Toolkit, use the CUDA Whisper image without
changing the normal local CPU setup:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

The override reserves one NVIDIA GPU for `whisper`; set `STT_MODEL` in the
environment to choose a compatible Faster Whisper model. Benchmark latency and
accuracy in the target environment before using it for anonymous sessions.

Apps:

- Frontend: `http://localhost:13000`
- Backend API: `http://localhost:18080`
- PostgreSQL: `localhost:55432` (`ghosttalk/ghosttalk`)

Local compose now binds backend and PostgreSQL to `127.0.0.1` only, so they are not exposed to the LAN by default.

You can override host ports without editing files:

```bash
HOST_FRONTEND_PORT=13001 HOST_BACKEND_PORT=18081 HOST_DB_PORT=55433 docker compose up --build
```

Frontend in Docker proxies `/api/*` to the backend container, so `VITE_API_BASE` can stay empty and the browser does not need direct access to the backend port.

Embedded video is enabled only when the backend receives:

```text
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
MEDIA_TOPOLOGY=dual
```

`MEDIA_TOPOLOGY=dual` is the privacy-safe voice path: participant raw audio
goes to `ghosttalk-<code>-input`, while everyone joins the public room and
receives only processed anonymous audio. Keep `single` only for deployments
that intentionally use browser-local processing.

For production CSP, set `CSP_CONNECT_SRC` to the exact origins the browser should contact, for example:

```text
CSP_CONNECT_SRC="'self' https://ghost-talk.example.com wss://meet.ghost-talk.example.com"
```

Avoid leaving `connect-src` wide open in production.

### Realtime media benchmark

Run the local CPU benchmark without contacting STT/TTS:

```bash
python3 tools/benchmark_media.py --skip-services --iterations 20
```

To include the worker-only STT/TTS routes, pass the same internal token used by
Compose. `--fail-on-thresholds` turns the documented p95 targets into a CI
gate; it is intentionally opt-in because CPU Whisper latency depends on the
host:

```bash
INTERNAL_WORKER_TOKEN=dev-internal python3 tools/benchmark_media.py \
  --iterations 3 --fail-on-thresholds
```

Run the static production privacy-boundary check before deployment:

```bash
python3 tools/security_check.py
```

Run a read-only concurrent API smoke test before a pilot. It does not create
sessions or write database state:

```bash
python3 tools/load_test.py --path /health --path /api/v1/voice-templates \
  --requests 500 --concurrency 25
```

Before a production deploy, validate the environment file. The check rejects
placeholder secrets, non-TLS LiveKit URLs, single-room topology and broad CSP:

```bash
python3 tools/production_preflight.py --env-file .env.prod
```

### Local LiveKit

For local development, the simplest option is the official LiveKit dev server:

```bash
livekit-server --dev --bind 0.0.0.0
```

If the shell reports `livekit-server: command not found`, the LiveKit Server
binary is not installed or is not available in `PATH`. You can verify this with:

```bash
command -v livekit-server
```

As an alternative to installing the binary locally, run the official Docker
image:

```bash
docker run --rm \
  -p 7880:7880 \
  -p 7881:7881 \
  -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0
```

In either case, keep this process running in a separate terminal while using
GhostTalk. The local LiveKit server is available at `http://localhost:7880`.

In this mode LiveKit uses the default development credentials:

```text
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

GhostTalk's backend runs in Docker, while the browser also uses
`LIVEKIT_URL`. Therefore this URL must be reachable from **both** the backend
container and the browser. Do not use `127.0.0.1` (or `localhost`) when
LiveKit is started separately with `docker run`: from the backend container it
refers to the backend container itself.

Set `LIVEKIT_URL` to the host's LAN IP address and open GhostTalk using that
same address. For example, if the Docker host is `10.110.12.212`, put this in
`.env`:

```text
LIVEKIT_URL=ws://10.110.12.212:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Recommended local startup flow:

1. Start LiveKit:

```bash
livekit-server --dev --bind 0.0.0.0
```

2. Start or rebuild GhostTalk:

```bash
docker compose up -d --build
```

3. If LiveKit was started after GhostTalk, restart the backend so it reloads the env:

```bash
docker compose up -d --build backend
```

For another host IP, replace `10.110.12.212` above with the address assigned
to your Docker host. Check it with:

```bash
hostname -I
```

The development server is intentionally unauthenticated apart from its default
credentials; use it only for local development, not on a public network.

## Deploy To Remote Server

Production deploy uses `docker-compose.prod.yml`.
This production compose file does two things:

- publishes the frontend on ports `80` and `443`
- keeps `backend` and `db` internal to the Docker network
- can start in plain HTTP mode first, then switch to HTTPS-only after a certificate is issued
- uses a reduced PostgreSQL memory profile suitable for a small VPS

If you want your own video infrastructure, deploy a separate LiveKit stack and set:

```text
LIVEKIT_URL=wss://livekit.your-domain.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

Detailed setup notes are in [docs/self-hosted-livekit.md](/home/d/source/ghost_talk/docs/self-hosted-livekit.md:1).

## Dependency Scan

Frontend:

```bash
cd frontend
npm run audit:deps
```

Backend modules:

```bash
cd backend
go list -m -u all
```

TTS Python service:

```bash
python3 -m pip install pip-audit
pip-audit -r tts/requirements.txt
```

Container images:

```bash
docker scout quickview
```

### Server prerequisites

- Ubuntu/Debian server with Docker Engine and Docker Compose plugin installed
- SSH access to the server
- A DNS name pointing to the server for browser-trusted HTTPS
- Open inbound TCP ports `80` and `443`

If Docker is not installed yet on Ubuntu, install it first:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
```

### One-time server setup

```bash
ssh root@YOUR_SERVER_IP
mkdir -p /opt/ghost_talk
cat > /opt/ghost_talk/.env <<'EOF'
HOST_FRONTEND_HTTP_PORT=80
HOST_FRONTEND_HTTPS_PORT=443
ENABLE_TLS=false
SERVER_NAME=ghost-talk.online
TLS_CERTS_DIR=./certs
CERTBOT_WWW_PATH=./certbot-www
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
EOF
```

For a non-root user, use any writable app directory instead, for example:

```bash
mkdir -p ~/ghost_talk
cat > ~/ghost_talk/.env <<'EOF'
HOST_FRONTEND_HTTP_PORT=80
HOST_FRONTEND_HTTPS_PORT=443
ENABLE_TLS=false
SERVER_NAME=ghost-talk.online
TLS_CERTS_DIR=./certs
CERTBOT_WWW_PATH=./certbot-www
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
EOF
```

If `80` or `443` is already occupied on the target server, set other published ports instead, for example:

```bash
cat > /opt/ghost_talk/.env <<'EOF'
HOST_FRONTEND_HTTP_PORT=13000
HOST_FRONTEND_HTTPS_PORT=13443
ENABLE_TLS=false
SERVER_NAME=ghost-talk.online
TLS_CERTS_DIR=./certs
CERTBOT_WWW_PATH=./certbot-www
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
EOF
```

### Upload current project state

From the local machine:

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ USER@YOUR_SERVER_IP:/path/to/ghost_talk/
```

### Start or update services

```bash
ssh root@YOUR_SERVER_IP
cd /path/to/ghost_talk
docker compose -f docker-compose.prod.yml up -d --build
```

At this point the app serves plain HTTP and exposes the ACME webroot at `/.well-known/acme-challenge/`.

### Issue a TLS certificate

Point your DNS name at the server first. For example:

- `ghost-talk.online -> YOUR_SERVER_IP`

Then issue a Let's Encrypt certificate while the stack is running:

```bash
cd /path/to/ghost_talk
./deploy/reissue-letsencrypt.sh ghost-talk.online
```

If you prefer to do the `certbot` step manually, use the same webroot and domain:

```bash
sudo certbot certonly \
  --webroot \
  -w /path/to/ghost_talk/certbot-www \
  --cert-name ghost-talk.online \
  -d ghost-talk.online
```

After the certificate is issued, `.env` must point at the live certificate directory and keep TLS enabled:

```bash
cat > /path/to/ghost_talk/.env <<'EOF'
HOST_FRONTEND_HTTP_PORT=80
HOST_FRONTEND_HTTPS_PORT=443
ENABLE_TLS=true
SERVER_NAME=ghost-talk.online
TLS_CERTS_DIR=/etc/letsencrypt/live/ghost-talk.online
CERTBOT_WWW_PATH=./certbot-www
LIVEKIT_URL=wss://meet.ghost-talk.online
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=replace-with-strong-secret
EOF
```

Redeploy the frontend:

```bash
cd /path/to/ghost_talk
docker compose -f docker-compose.prod.yml up -d --build frontend
```

The frontend container will then:

- serve `https://ghost-talk.online/`
- reject plain HTTP traffic on `80`
- keep `/.well-known/acme-challenge/` reachable on port `80` for renewals

### Verify deployment

```bash
docker compose -f docker-compose.prod.yml ps
curl -I http://ghost-talk.online/
curl -I https://ghost-talk.online/
curl https://ghost-talk.online/health
```

Expected result:

- `http://ghost-talk.online/` is rejected after TLS is enabled
- `https://ghost-talk.online/` serves the frontend
- `/health` returns `{"status":"ok"}`
- API requests from the browser go through the frontend nginx proxy to the backend container

### Redeploy after changes

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ USER@YOUR_SERVER_IP:/path/to/ghost_talk/

ssh USER@YOUR_SERVER_IP
cd /path/to/ghost_talk
docker compose -f docker-compose.prod.yml up -d --build
```

### Current deployment

Current live deployment was performed on:

```text
ghost@10.110.12.212
```

Project directory:

```text
/home/ghost/ghost_talk
```

Published URL:

```text
https://ghost-talk.online/
```

Public DNS for this deployment should point `ghost-talk.online` at `10.110.12.212`, after which a normal Let's Encrypt certificate can be issued.

### Ready-made env template

Use [.env.prod.example](/home/d/source/ghost_talk/.env.prod.example:1) as the final post-certificate template. It is already prepared for `ghost-talk.online`.

## Internal CA for LAN

If you do not have a public domain and the app stays inside LAN, use an internal CA instead of Let's Encrypt.

- Recommended internal name: `ghosttalk.home.arpa`
- Current LAN host IP: `10.110.12.212`
- LAN env template: [.env.lan.example](/home/d/source/ghost_talk/.env.lan.example:1)
- LAN compose file: [docker-compose.lan.yml](/home/d/source/ghost_talk/docker-compose.lan.yml:1)
- Full guide: [docs/internal-ca-lan.md](/home/d/source/ghost_talk/docs/internal-ca-lan.md:1)

The LAN compose file publishes only `443`, so plain HTTP is not exposed on the host in this mode.

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
