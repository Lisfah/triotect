#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/add-admin.sh
# Interactively creates a new admin account in the identity database.
#
# USAGE:
#   ./scripts/add-admin.sh
# ──────────────────────────────────────────────────────────────────────────────

IDENTITY_CONTAINER="${IDENTITY_DB_CONTAINER:-triotect-identity-db}"
IDENTITY_USER="${IDENTITY_DB_USER:-identity_user}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-identity_db}"
IDENTITY_APP_CONTAINER="${IDENTITY_APP_CONTAINER:-triotect-identity-provider}"

echo ""
echo "============================================================"
echo " TrioTect — Add Admin"
echo "============================================================"
echo ""

# ── Check containers are running ──────────────────────────────────────────────
if ! docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c "SELECT 1" -q >/dev/null 2>&1; then
    echo "❌  identity-db is not running. Start the stack first:"
    echo "    docker compose -f deploy/local/docker-compose.yml up -d"
    exit 1
fi

# ── Collect input ─────────────────────────────────────────────────────────────
read -rp "Admin ID   : " ADMIN_ID
[[ -z "$ADMIN_ID" ]] && { echo "❌  Admin ID cannot be empty."; exit 1; }

read -rp "Full name  : " FULL_NAME
[[ -z "$FULL_NAME" ]] && { echo "❌  Full name cannot be empty."; exit 1; }

read -rp "Email      : " EMAIL
[[ -z "$EMAIL" ]] && { echo "❌  Email cannot be empty."; exit 1; }

read -rsp "Password   : " PASSWORD
echo ""
[[ ${#PASSWORD} -lt 6 ]] && { echo "❌  Password must be at least 6 characters."; exit 1; }

read -rsp "Confirm pw : " PASSWORD2
echo ""
[[ "$PASSWORD" != "$PASSWORD2" ]] && { echo "❌  Passwords do not match."; exit 1; }

# ── Check for duplicate ───────────────────────────────────────────────────────
EXISTING=$(docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -tAc \
    "SELECT COUNT(*) FROM users WHERE student_id = '$ADMIN_ID';")
if [[ "$EXISTING" -gt 0 ]]; then
    echo "❌  An account with ID '$ADMIN_ID' already exists."
    exit 1
fi

# ── Hash password using identity-provider's Python env ────────────────────────
echo ""
echo "Hashing password…"
HASHED=$(docker exec "$IDENTITY_APP_CONTAINER" python3 -c \
    "from passlib.context import CryptContext; \
     pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto'); \
     print(pwd_context.hash('$PASSWORD'))" 2>/dev/null)

if [[ -z "$HASHED" ]]; then
    echo "❌  Failed to hash password. Is the identity-provider container running?"
    exit 1
fi

# ── Insert into database ──────────────────────────────────────────────────────
docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c \
    "INSERT INTO users (id, student_id, email, hashed_password, full_name, is_admin, is_active, created_at, updated_at)
     VALUES (gen_random_uuid()::text, '$ADMIN_ID', '$EMAIL', '$HASHED', '$FULL_NAME', true, true, NOW(), NOW());"

echo ""
echo "✅  Admin '$ADMIN_ID' created successfully."
echo "    Login: POST http://localhost:8001/auth/login"
echo "    Body:  {\"student_id\": \"$ADMIN_ID\", \"password\": \"<your password>\"}"
echo ""
