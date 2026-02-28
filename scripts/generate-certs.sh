#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/generate-certs.sh
# Generates SSL certificates for TrioTect.
#
# Usage:
#   ./generate-certs.sh local       — self-signed cert for localhost dev
#   ./generate-certs.sh staging     — self-signed cert for staging server
#   ./generate-certs.sh production  — Let's Encrypt cert via certbot
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${1:-local}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load env
ENV_FILE="${ROOT_DIR}/deploy/${MODE}/.env"
if [[ -f "$ENV_FILE" ]]; then
    set -a; source "$ENV_FILE"; set +a
fi

DOMAIN="${DOMAIN:-localhost}"

echo "============================================================"
echo " TrioTect — SSL Certificate Generation"
echo " Mode: ${MODE}  |  Domain: ${DOMAIN}"
echo "============================================================"

SSL_DIR="${ROOT_DIR}/deploy/${MODE}/ssl"
mkdir -p "$SSL_DIR"

case "$MODE" in
    local)
        echo ""
        echo "── Generating self-signed certificate for localhost ──"
        openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
            -keyout "${SSL_DIR}/privkey.pem" \
            -out "${SSL_DIR}/fullchain.pem" \
            -subj "/C=BD/ST=Dhaka/L=Dhaka/O=IUT Cafeteria Dev/CN=localhost" \
            -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
        echo "   ✅ Self-signed cert generated at ${SSL_DIR}/"
        echo "   ⚠️  Add 'localhost' to browser trusted certificates for local HTTPS"
        ;;

    staging)
        echo ""
        if [[ -z "${STAGING_SERVER_IP:-}" ]]; then
            echo "⚠️  STAGING_SERVER_IP not set. Generating generic self-signed cert."
            openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
                -keyout "${SSL_DIR}/privkey.pem" \
                -out "${SSL_DIR}/fullchain.pem" \
                -subj "/C=BD/ST=Dhaka/L=Dhaka/O=IUT Cafeteria Staging/CN=${DOMAIN}" \
                -addext "subjectAltName=DNS:${DOMAIN},IP:${STAGING_SERVER_IP:-127.0.0.1}"
        else
            openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
                -keyout "${SSL_DIR}/privkey.pem" \
                -out "${SSL_DIR}/fullchain.pem" \
                -subj "/C=BD/ST=Dhaka/L=Dhaka/O=IUT Cafeteria Staging/CN=${DOMAIN}" \
                -addext "subjectAltName=DNS:${DOMAIN},IP:${STAGING_SERVER_IP}"
        fi
        echo "   ✅ Staging self-signed cert generated at ${SSL_DIR}/"
        ;;

    production)
        echo ""
        echo "── Obtaining Let's Encrypt certificate via certbot ──"
        if [[ -z "${DOMAIN:-}" ]] || [[ "$DOMAIN" == "localhost" ]]; then
            echo "❌ ERROR: Set DOMAIN to your production domain in deploy/production/.env"
            exit 1
        fi
        if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
            echo "❌ ERROR: Set CERTBOT_EMAIL in deploy/production/.env"
            exit 1
        fi

        # Check if certbot is installed
        if ! command -v certbot &>/dev/null; then
            echo "Installing certbot..."
            apt-get update && apt-get install -y certbot
        fi

        # Stop Nginx temporarily to free port 80
        docker compose -f "${ROOT_DIR}/deploy/production/docker-compose.yml" stop nginx 2>/dev/null || true

        certbot certonly --standalone \
            --non-interactive \
            --agree-tos \
            --email "${CERTBOT_EMAIL}" \
            --domains "${DOMAIN}" \
            --cert-path "${SSL_DIR}/fullchain.pem" \
            --key-path "${SSL_DIR}/privkey.pem"

        # Copy Let's Encrypt certs
        cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${SSL_DIR}/fullchain.pem"
        cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "${SSL_DIR}/privkey.pem"

        echo "   ✅ Let's Encrypt cert obtained for ${DOMAIN}"
        echo "   ℹ️  Set up certbot renew cronjob:"
        echo "       0 0 * * 0 certbot renew --quiet && docker compose restart nginx"

        # Restart Nginx
        docker compose -f "${ROOT_DIR}/deploy/production/docker-compose.yml" start nginx 2>/dev/null || true
        ;;

    *)
        echo "❌ Unknown mode: ${MODE}"
        echo "Usage: $0 [local|staging|production]"
        exit 1
        ;;
esac

echo ""
echo " Certificate files:"
echo "   ${SSL_DIR}/fullchain.pem"
echo "   ${SSL_DIR}/privkey.pem"
chmod 600 "${SSL_DIR}/privkey.pem"
echo ""
echo "============================================================"
