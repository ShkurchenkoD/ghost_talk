# GhostTalk

GhostTalk — self-hosted вебплатформа для структурованих анонімних командних
сесій. Вона допомагає збирати чесні думки, проводити голосування в реальному
часі, безпечно спілкуватися у відеокімнаті та перетворювати розмову на
перевірений протокол, висновки й action items.

## Stack

- Frontend: React + Vite
- Backend: Go (`net/http`) + SSE realtime
- Database: PostgreSQL
- Realtime: Server-Sent Events (`/api/sessions/:code/events`)
- Speech pipeline: Faster Whisper STT, worker-side transcript segments and no raw voice file storage
- Video rooms: embedded LiveKit rooms via `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`
- Anonymous audio mode: backend-controlled safe mode with `mute` fallback, readiness worker, and consent-gated `media-worker` transcription

## Features Implemented

- Facilitator creates session with methodology
- Join code and link generation
- Anonymous participant join (token-based, no registration)
- Anonymous card submission (text plus legacy browser prompt voice fallback)
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

Production deploy uses `docker-compose.prod.yml` on the core application host
and `deploy/livekit/` on a separate RTC host.

Current production layout:

```text
ghost-core  35.204.17.207  10.164.0.2  /opt/ghosttalk
ghost-rtc   34.158.79.220  10.164.0.4  /opt/ghosttalk-livekit
```

Public names:

```text
ghost-talk.online       Cloudflare proxied HTTPS -> ghost-core
meet.ghost-talk.online  LiveKit/RTC hostname -> ghost-rtc
```

The production compose file:

- publishes only the frontend on host ports `80` and `443`;
- keeps `backend`, PostgreSQL, Redis and workers internal to the Docker network;
- does not start bundled LiveKit by default;
- uses a reduced PostgreSQL memory profile suitable for a small VM.

For the two-VM layout, run LiveKit from `deploy/livekit/` on `ghost-rtc`.
The bundled LiveKit service is only for single-host deployments:

```bash
docker compose -f docker-compose.prod.yml --profile bundled-livekit up -d --build
```

Detailed LiveKit notes are in [docs/self-hosted-livekit.md](/home/d/source/ghost_talk/docs/self-hosted-livekit.md:1).

### Production secrets and env files

Real env files are intentionally ignored by git:

```text
.env
.env.prod
deploy/livekit/.env
```

Only example files should be committed. Use
[.env.prod.example](/home/d/source/ghost_talk/.env.prod.example:1) as the
current production template and replace placeholder secrets before deploying.
Never commit generated `LIVEKIT_API_SECRET`, `INTERNAL_WORKER_TOKEN`,
Cloudflare API tokens, TLS keys or certbot credentials.

### Server prerequisites

- Ubuntu 24.04 or another Docker-capable Linux host
- Docker Engine and Docker Compose plugin
- SSH access to both VMs
- Cloudflare DNS for `ghost-talk.online`
- Cloudflare SSL/TLS mode set to `Full (strict)`
- Cloudflare `Always Use HTTPS` enabled

Install Docker on a fresh Ubuntu host:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in, or use `newgrp docker`, before running Docker as the SSH
user.

### DNS and firewall

Cloudflare records:

```text
ghost-talk.online       A  35.204.17.207  Proxied
meet.ghost-talk.online  A  34.158.79.220  DNS only
```

Core app traffic should not be open to the whole internet. In GCP firewall,
allow `tcp:443` to `ghost-core` only from Cloudflare IP ranges. Fetch the
current ranges before creating or updating the rule:

```bash
curl -fsS https://www.cloudflare.com/ips-v4
curl -fsS https://www.cloudflare.com/ips-v6
```

Direct access to `35.204.17.207:443` should time out, while
`https://ghost-talk.online/` should work through Cloudflare.

For RTC media, configure the `ghost-rtc` firewall separately:

```text
tcp:80,443    ACME and HTTPS/WSS signaling through Caddy
tcp:7881      LiveKit TCP fallback
udp:50000-50100 LiveKit media
```

Keep `7880/tcp` private; Caddy proxies browser-facing WSS to LiveKit locally.

### Core VM setup

Upload the repository to `ghost-core`:

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.prod' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ d_shkurchenko@35.204.17.207:/opt/ghosttalk/
```

Create `/opt/ghosttalk/.env` from `.env.prod.example`, replace placeholders
with generated secrets, and keep the two-VM LiveKit upstream:

```text
HOST_FRONTEND_HTTP_PORT=80
HOST_FRONTEND_HTTPS_PORT=443
ENABLE_TLS=true
SERVER_NAME=ghost-talk.online
LIVEKIT_SERVER_NAME=meet.ghost-talk.online
TLS_CERTS_DIR=/etc/letsencrypt
TLS_CERT_PATH_CONTAINER=/etc/nginx/tls/live/ghost-talk.online/fullchain.pem
TLS_KEY_PATH_CONTAINER=/etc/nginx/tls/live/ghost-talk.online/privkey.pem
CERTBOT_WWW_PATH=./certbot-www
LIVEKIT_URL=wss://meet.ghost-talk.online
LIVEKIT_UPSTREAM=http://10.164.0.4:7880
MEDIA_TOPOLOGY=dual
LIVEKIT_API_KEY=ghosttalk-prod
LIVEKIT_API_SECRET=<generated-secret>
INTERNAL_WORKER_TOKEN=<generated-secret>
CSP_CONNECT_SRC="'self' https://ghost-talk.online wss://meet.ghost-talk.online"
CORS_ALLOWED_ORIGINS=https://ghost-talk.online
```

Generate secrets locally or on the VM:

```bash
openssl rand -hex 32
```

Start or update core services:

```bash
ssh d_shkurchenko@35.204.17.207
cd /opt/ghosttalk
docker compose -f docker-compose.prod.yml up -d --build
```

### HTTPS certificate with Cloudflare DNS-01

The current production certificate is issued on `ghost-core` with Certbot's
Cloudflare DNS plugin. This avoids opening `80/tcp` to the internet.

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-dns-cloudflare
sudo install -d -m 700 /root/.secrets/certbot
sudo sh -c 'umask 077; printf "%s\n" "dns_cloudflare_api_token = <cloudflare-dns-api-token>" > /root/.secrets/certbot/cloudflare.ini'
sudo certbot certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  --cert-name ghost-talk.online \
  -d ghost-talk.online
```

Reload nginx after renewals:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/ghosttalk-reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
set -eu
cd /opt/ghosttalk
/usr/bin/docker compose -f docker-compose.prod.yml exec -T frontend nginx -s reload || \
  /usr/bin/docker compose -f docker-compose.prod.yml restart frontend
EOF
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/ghosttalk-reload-nginx.sh
```

After issuing the certificate, recreate the frontend so nginx picks up HTTPS:

```bash
cd /opt/ghosttalk
docker compose -f docker-compose.prod.yml up -d frontend
```

### RTC VM setup

Upload the LiveKit stack:

```bash
rsync -az ./deploy/livekit/ d_shkurchenko@34.158.79.220:/opt/ghosttalk-livekit/
```

Create `/opt/ghosttalk-livekit/.env` from
[deploy/livekit/.env.example](/home/d/source/ghost_talk/deploy/livekit/.env.example:1)
and set `LIVEKIT_API_SECRET` to the same value as core.

Start LiveKit:

```bash
ssh d_shkurchenko@34.158.79.220
cd /opt/ghosttalk-livekit
docker compose up -d
```

If DNS and the RTC firewall are ready, Caddy terminates public WSS on
`meet.ghost-talk.online` and proxies to local LiveKit signaling.

### Verify deployment

From any machine:

```bash
curl -I http://ghost-talk.online/
curl -I https://ghost-talk.online/
curl https://ghost-talk.online/health
```

Expected result:

- `http://ghost-talk.online/` returns `301` to HTTPS;
- `https://ghost-talk.online/` returns `200` through Cloudflare;
- `/health` returns `{"status":"ok"}`;
- direct `35.204.17.207:443` access times out unless the source is Cloudflare.

On `ghost-core`:

```bash
cd /opt/ghosttalk
docker compose -f docker-compose.prod.yml ps
certbot certificates --cert-name ghost-talk.online
```

On `ghost-rtc`:

```bash
cd /opt/ghosttalk-livekit
docker compose ps
```

### Redeploy after changes

```bash
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.prod' \
  --exclude 'frontend/node_modules' \
  --exclude 'frontend/dist' \
  ./ d_shkurchenko@35.204.17.207:/opt/ghosttalk/

ssh d_shkurchenko@35.204.17.207
cd /opt/ghosttalk
docker compose -f docker-compose.prod.yml up -d --build
```

### Current deployment status

The main application is live at:

```text
https://ghost-talk.online/
```

The current externally verified behavior is:

```text
https://ghost-talk.online/        -> HTTP/2 200
http://ghost-talk.online/         -> 301 to HTTPS
https://ghost-talk.online/health  -> {"status":"ok"}
```

Core origin HTTPS is protected behind Cloudflare; direct access to the core
public IP should not be open to arbitrary clients.

### Ready-made env template

Use [.env.prod.example](/home/d/source/ghost_talk/.env.prod.example:1) as the
final production template. It is prepared for:

```text
ghost-talk.online
meet.ghost-talk.online
```

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

## Internal CA for LAN

If you do not have a public domain and the app stays inside LAN, use an internal CA instead of Let's Encrypt.

- Recommended internal name: `ghosttalk.home.arpa`
- Example LAN host IP used in the docs: `10.110.12.212`
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

## Privacy Notes

- Participant identity is anonymous to other participants.
- No participant names are displayed.
- Raw voice files are not stored by default.
- Live speech transcription runs through the worker/STT pipeline after participant consent.
- Basic input validation is enforced server-side.
