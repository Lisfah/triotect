#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/list-admins.sh
# Lists all admin accounts in the identity database.
#
# USAGE:
#   ./scripts/list-admins.sh
# ──────────────────────────────────────────────────────────────────────────────

IDENTITY_CONTAINER="${IDENTITY_DB_CONTAINER:-triotect-identity-db}"
IDENTITY_USER="${IDENTITY_DB_USER:-identity_user}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-identity_db}"

echo ""
echo "============================================================"
echo " TrioTect — Admin Accounts"
echo "============================================================"
echo ""

# ── Check container is running ────────────────────────────────────────────────
if ! docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c "SELECT 1" -q >/dev/null 2>&1; then
    echo "❌  identity-db is not running. Start the stack first:"
    echo "    docker compose -f deploy/local/docker-compose.yml up -d"
    exit 1
fi

# ── Query admins ──────────────────────────────────────────────────────────────
docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c \
    "SELECT student_id AS \"Admin ID\", full_name AS \"Full Name\", email AS \"Email\", is_active AS \"Active\", created_at AS \"Created At\"
     FROM users
     WHERE is_admin = true
     ORDER BY created_at;"

echo ""
