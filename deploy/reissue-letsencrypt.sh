#!/bin/sh
set -eu

DOMAIN="${1:-}"

if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

case "$DOMAIN" in
  *[!A-Za-z0-9.-]* | .* | *..* | *- | "")
    echo "Invalid domain: $DOMAIN" >&2
    exit 1
    ;;
esac

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$APP_DIR/.env"
ENV_BACKUP="$APP_DIR/.env.backup.$(date +%Y%m%d%H%M%S)"
CERTBOT_WWW_PATH="$APP_DIR/certbot-www"
TLS_CERTS_DIR="/etc/letsencrypt/live/$DOMAIN"
TLS_CERTS_MOUNT_DIR="/etc/letsencrypt"
TLS_CERT_PATH_CONTAINER="/etc/nginx/tls/live/$DOMAIN/fullchain.pem"
TLS_KEY_PATH_CONTAINER="/etc/nginx/tls/live/$DOMAIN/privkey.pem"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot is required" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

mkdir -p "$CERTBOT_WWW_PATH"
cd "$APP_DIR"

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_BACKUP"
else
  : > "$ENV_FILE"
  cp "$ENV_FILE" "$ENV_BACKUP"
fi

update_env_key() {
  key="$1"
  value="$2"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

update_env_key "ENABLE_TLS" "false"
update_env_key "SERVER_NAME" "$DOMAIN"
update_env_key "TLS_CERTS_DIR" "$TLS_CERTS_MOUNT_DIR"
update_env_key "CERTBOT_WWW_PATH" "./certbot-www"
update_env_key "TLS_CERT_PATH_CONTAINER" "$TLS_CERT_PATH_CONTAINER"
update_env_key "TLS_KEY_PATH_CONTAINER" "$TLS_KEY_PATH_CONTAINER"

echo "Starting frontend in HTTP mode for ACME validation"
docker compose -f "$APP_DIR/docker-compose.prod.yml" up -d frontend

echo "Requesting Let's Encrypt certificate for $DOMAIN"
$SUDO certbot certonly \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email \
  --webroot \
  -w "$CERTBOT_WWW_PATH" \
  --cert-name "$DOMAIN" \
  -d "$DOMAIN"

update_env_key "ENABLE_TLS" "true"

echo "Reloading frontend with HTTPS"
docker compose -f "$APP_DIR/docker-compose.prod.yml" up -d frontend

echo
echo "Certificate issued for https://$DOMAIN"
echo "Updated $ENV_FILE"
echo "Backup saved to $ENV_BACKUP"
