#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/delete-admin.sh
# Interactively deletes an admin account from the identity database.
# Requires confirmation and password verification before deletion.
#
# USAGE:
#   ./scripts/delete-admin.sh
# ──────────────────────────────────────────────────────────────────────────────

IDENTITY_CONTAINER="${IDENTITY_DB_CONTAINER:-triotect-identity-db}"
IDENTITY_USER="${IDENTITY_DB_USER:-identity_user}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-identity_db}"
IDENTITY_APP_CONTAINER="${IDENTITY_APP_CONTAINER:-triotect-identity-provider}"

echo ""
echo "============================================================"
echo " TrioTect — Delete Admin"
echo "============================================================"
echo ""

# ── Check containers are running ──────────────────────────────────────────────
if ! docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c "SELECT 1" -q >/dev/null 2>&1; then
    echo "❌  identity-db is not running. Start the stack first:"
    echo "    docker compose -f deploy/local/docker-compose.yml up -d"
    exit 1
fi

# ── Confirm intent ────────────────────────────────────────────────────────────
read -rp "Are you sure you want to delete an admin account? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
fi

# ── Collect credentials ───────────────────────────────────────────────────────
echo ""
read -rp "Admin ID   : " ADMIN_ID
[[ -z "$ADMIN_ID" ]] && { echo "❌  Admin ID cannot be empty."; exit 1; }

read -rsp "Password   : " PASSWORD
echo ""
[[ -z "$PASSWORD" ]] && { echo "❌  Password cannot be empty."; exit 1; }

# ── Look up the account ───────────────────────────────────────────────────────
ROW=$(docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -tAc \
    "SELECT hashed_password, is_admin FROM users WHERE student_id = '$ADMIN_ID';")

if [[ -z "$ROW" ]]; then
    echo "❌  No account found with ID '$ADMIN_ID'."
    exit 1
fi

HASHED_PW=$(echo "$ROW" | cut -d'|' -f1)
IS_ADMIN=$(echo "$ROW" | cut -d'|' -f2)

if [[ "$IS_ADMIN" != "t" ]]; then
    echo "❌  '$ADMIN_ID' is not an admin account."
    exit 1
fi

# ── Verify password ────────────────────────────────────────────────────────────
VALID=$(docker exec "$IDENTITY_APP_CONTAINER" python3 -c \
    "from passlib.context import CryptContext; \
     pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto'); \
     print('ok' if pwd_context.verify('$PASSWORD', '$HASHED_PW') else 'fail')" 2>/dev/null)

if [[ "$VALID" != "ok" ]]; then
    echo "❌  Incorrect password. Deletion aborted."
    exit 1
fi

# ── Delete ────────────────────────────────────────────────────────────────────
docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c \
    "DELETE FROM users WHERE student_id = '$ADMIN_ID' AND is_admin = true;"

echo ""
echo "✅  Admin '$ADMIN_ID' has been deleted."
echo ""
