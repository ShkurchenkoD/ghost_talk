# LiveKit Deploy

This directory is a minimal LiveKit deployment for a separate host such as
`ghost@10.110.12.212` or a public VM serving `meet.ghost-talk.online`.

It is intentionally small and suitable for both LAN testing and a basic public deployment:

- Caddy TLS reverse proxy for browser-facing `wss://`
- single LiveKit container
- host networking, which LiveKit recommends for Dockerized deployments
- `ws://10.110.12.212:7880` for LAN testing or `wss://meet.ghost-talk.online` behind TLS
- reduced UDP range for simpler firewall setup

## Files

- `docker-compose.yml` - starts LiveKit with host networking
- `Caddyfile` - terminates public HTTPS/WSS and proxies to LiveKit signaling
- `.env.example` - variables to copy into `.env`

## First-time setup on the target host

Create a working directory on the target host:

```bash
mkdir -p ~/livekit
```

Copy these files to the target host:

```bash
rsync -av ./deploy/livekit/ ghost@10.110.12.212:~/livekit/
```

Create the runtime env file:

```bash
cd ~/livekit
cp .env.example .env
```

Edit `.env` and set a strong `LIVEKIT_API_SECRET`.

## Start LiveKit

```bash
cd ~/livekit
docker compose up -d
```

## Verify

Check the container:

```bash
cd ~/livekit
docker compose ps
docker compose logs --tail=100
```

For a LAN test, the GhostTalk backend should use:

```text
LIVEKIT_URL=ws://10.110.12.212:7880
LIVEKIT_API_KEY=ghosttalk-prod
LIVEKIT_API_SECRET=<same secret as on the LiveKit host>
```

For a public deployment, the GhostTalk backend should use:

```text
LIVEKIT_URL=wss://meet.ghost-talk.online
LIVEKIT_API_KEY=ghosttalk-prod
LIVEKIT_API_SECRET=<same secret as on the LiveKit host>
```

## Required ports

At minimum, allow these on the LiveKit host:

- `80/tcp` - ACME HTTP challenge and HTTP-to-HTTPS handling
- `443/tcp` - HTTPS/WSS signaling through Caddy
- `7881/tcp` - RTC over TCP fallback
- `50000-50100/udp` - RTC media

Do not allow public access to Redis, Docker, or unrelated application ports.
LiveKit signaling on `7880/tcp` should remain private or blocked at the GCP/host firewall.

## Public HTTPS/WSS

For a public hostname such as `meet.ghost-talk.online`, you should:

1. point DNS at the `ghost-rtc` public IP,
2. set `LIVEKIT_URL` in GhostTalk to `wss://meet.ghost-talk.online`,
3. set `LIVEKIT_USE_EXTERNAL_IP=true`,
4. open and verify only the TCP/UDP paths listed above.

References:

- LiveKit deployment docs: https://docs.livekit.io/transport/self-hosting/deployment/
- LiveKit local docs: https://docs.livekit.io/transport/self-hosting/local/
