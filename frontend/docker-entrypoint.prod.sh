#!/bin/sh
set -eu

SERVER_NAME="${SERVER_NAME:-_}"
LIVEKIT_SERVER_NAME="${LIVEKIT_SERVER_NAME:-_}"
ENABLE_TLS="${ENABLE_TLS:-false}"
CERTBOT_WWW_ROOT="${CERTBOT_WWW_ROOT:-/var/www/certbot}"
TLS_CERT_PATH_CONTAINER="${TLS_CERT_PATH_CONTAINER:-/etc/nginx/tls/fullchain.pem}"
TLS_KEY_PATH_CONTAINER="${TLS_KEY_PATH_CONTAINER:-/etc/nginx/tls/privkey.pem}"
LIVEKIT_TLS_CERT_PATH_CONTAINER="${LIVEKIT_TLS_CERT_PATH_CONTAINER:-/etc/nginx/tls/livekit/fullchain.pem}"
LIVEKIT_TLS_KEY_PATH_CONTAINER="${LIVEKIT_TLS_KEY_PATH_CONTAINER:-/etc/nginx/tls/livekit/privkey.pem}"
BACKEND_HOST="${BACKEND_HOST:-backend}"
LIVEKIT_UPSTREAM="${LIVEKIT_UPSTREAM:-http://livekit:7880}"
CSP_CONNECT_SRC="${CSP_CONNECT_SRC:-'self' https: wss:}"

if [ ! -f "$LIVEKIT_TLS_CERT_PATH_CONTAINER" ] || [ ! -f "$LIVEKIT_TLS_KEY_PATH_CONTAINER" ]; then
  LIVEKIT_TLS_CERT_PATH_CONTAINER="$TLS_CERT_PATH_CONTAINER"
  LIVEKIT_TLS_KEY_PATH_CONTAINER="$TLS_KEY_PATH_CONTAINER"
fi

mkdir -p /etc/nginx/conf.d "$CERTBOT_WWW_ROOT"

if [ "$ENABLE_TLS" = "true" ] && [ -f "$TLS_CERT_PATH_CONTAINER" ] && [ -f "$TLS_KEY_PATH_CONTAINER" ]; then
  echo "Starting nginx with HTTPS for ${SERVER_NAME}"
  export SERVER_NAME LIVEKIT_SERVER_NAME CERTBOT_WWW_ROOT TLS_CERT_PATH_CONTAINER TLS_KEY_PATH_CONTAINER LIVEKIT_TLS_CERT_PATH_CONTAINER LIVEKIT_TLS_KEY_PATH_CONTAINER BACKEND_HOST LIVEKIT_UPSTREAM CSP_CONNECT_SRC
  envsubst '${SERVER_NAME} ${LIVEKIT_SERVER_NAME} ${CERTBOT_WWW_ROOT} ${TLS_CERT_PATH_CONTAINER} ${TLS_KEY_PATH_CONTAINER} ${LIVEKIT_TLS_CERT_PATH_CONTAINER} ${LIVEKIT_TLS_KEY_PATH_CONTAINER} ${BACKEND_HOST} ${LIVEKIT_UPSTREAM} ${CSP_CONNECT_SRC}' \
    < /etc/nginx/templates/https.conf.template \
    > /etc/nginx/conf.d/default.conf
else
  if [ "$ENABLE_TLS" = "true" ]; then
    echo "TLS requested but certificate files were not found; starting HTTP mode instead" >&2
  else
    echo "Starting nginx in HTTP mode for ${SERVER_NAME}"
  fi
  export SERVER_NAME LIVEKIT_SERVER_NAME CERTBOT_WWW_ROOT BACKEND_HOST LIVEKIT_UPSTREAM CSP_CONNECT_SRC
  envsubst '${SERVER_NAME} ${LIVEKIT_SERVER_NAME} ${CERTBOT_WWW_ROOT} ${BACKEND_HOST} ${LIVEKIT_UPSTREAM} ${CSP_CONNECT_SRC}' \
    < /etc/nginx/templates/http.conf.template \
    > /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
