# Internal CA for LAN

This setup is for private networks only.

- GhostTalk host: `10.110.12.212`
- Internal HTTPS name: `ghosttalk.home.arpa`
- Goal: trusted HTTPS inside LAN after installing your own root CA on client devices

## What this gives you

- HTTPS for `https://ghosttalk.home.arpa`
- no published HTTP port on the host
- browser trust only on devices where your root CA is installed

## Files in this repo

- LAN compose: [docker-compose.lan.yml](/home/d/source/ghost_talk/docker-compose.lan.yml:1)
- LAN env template: [.env.lan.example](/home/d/source/ghost_talk/.env.lan.example:1)
- Expected cert mount dir: [certs](/home/d/source/ghost_talk/certs/.gitkeep:1)

## 1. Make the name resolve inside LAN

Preferred: add an internal DNS record:

- `ghosttalk.home.arpa -> 10.110.12.212`

If you do not have internal DNS yet, add it to client `hosts` files temporarily:

```text
10.110.12.212 ghosttalk.home.arpa
```

Use the DNS name in browsers. Do not browse the app by raw IP if you want predictable TLS behavior.

## 2. Create an internal CA with step-ca

Install `step` and `step-ca` from Smallstep on the CA host.

Initialize the CA:

```bash
step ca init \
  --name "GhostTalk LAN" \
  --dns "ca.ghosttalk.home.arpa" \
  --address ":9000" \
  --provisioner "ghosttalk-admin@ghosttalk.home.arpa"
```

Start the CA:

```bash
step-ca "$(step path)/config/ca.json"
```

## 3. Issue the GhostTalk server certificate

Run this on a host that can reach your CA:

```bash
cd /path/to/ghost_talk
mkdir -p certs
step ca certificate "ghosttalk.home.arpa" certs/fullchain.pem certs/privkey.pem \
  --san ghosttalk.home.arpa \
  --san 10.110.12.212
```

For this repo, `certs/fullchain.pem` is the server certificate file mounted into nginx, and `certs/privkey.pem` is the server private key.

If your CA uses an intermediate chain, make sure `certs/fullchain.pem` contains the leaf certificate followed by the intermediate certificate(s).

## 4. Distribute the root CA certificate to client devices

Export the root CA certificate from your step-ca machine and distribute it to LAN clients.

Typical root CA path for step:

```bash
$(step path)/certs/root_ca.crt
```

Every client device that opens `https://ghosttalk.home.arpa` must trust that root CA.

- Windows: import into `Trusted Root Certification Authorities`
- macOS: import into `System` keychain and mark as trusted
- iPhone/iPad: install profile, then explicitly enable full trust
- Android: import the CA certificate according to your device management model

## 5. Start GhostTalk in LAN TLS mode

Create `.env` from the LAN template:

```bash
cd /path/to/ghost_talk
cp .env.lan.example .env
```

If your certs are not stored in the repo-local `./certs` directory, edit `.env` and point `TLS_CERTS_DIR` to the real directory.

Start the stack:

```bash
docker compose -f docker-compose.lan.yml up -d --build
```

This LAN compose file publishes only `443/tcp` on the host. It does not publish `80/tcp`.

## 6. Verify

From a trusted client machine:

```bash
curl -I https://ghosttalk.home.arpa
curl https://ghosttalk.home.arpa/health
```

Expected result:

- the certificate is accepted without browser warning
- the app opens at `https://ghosttalk.home.arpa`
- microphone access is allowed after browser permission is granted

## 7. Renew and replace certs

When the server cert is renewed, replace:

- `certs/fullchain.pem`
- `certs/privkey.pem`

Then restart only the frontend:

```bash
docker compose -f docker-compose.lan.yml up -d --build frontend
```

## 8. Run step-ca with systemd

Use the provided unit file:

- [deploy/systemd/step-ca.service](/home/d/source/ghost_talk/deploy/systemd/step-ca.service:1)

Install it on the CA host:

```bash
sudo cp /home/ghost/ghost_talk/deploy/systemd/step-ca.service /etc/systemd/system/step-ca.service
sudo systemctl daemon-reload
sudo systemctl enable --now step-ca
```

Verify:

```bash
sudo systemctl status step-ca
journalctl -u step-ca -n 100 --no-pager
```

This unit assumes:

- the CA runs as user `ghost`
- `step-ca` binary is at `/usr/bin/step-ca`
- `STEPPATH` is `/home/ghost/.step`

If your host differs, adjust those paths before installing the unit.

## Notes

- This is not publicly trusted HTTPS. It is trusted only inside your LAN after root CA installation.
- If a client does not trust your root CA, the browser will still show a certificate warning.
- If you later move to a public domain, use [docker-compose.prod.yml](/home/d/source/ghost_talk/docker-compose.prod.yml:1) instead.
