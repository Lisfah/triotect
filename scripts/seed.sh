#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/seed.sh
# Seeds initial CONFIGURATION DATA into the running local stack:
#   - 1 admin account (ADMIN-001 / AdminPass123!)
#   - 5 student accounts (210041001…005 / Student{N}Pass!)
#   - 6 menu items + inventory quantities
#
# MECHANISM:
#   Copies seed_users.sql and seed_menu.sql into the running DB containers
#   and executes them with psql. This approach avoids host-side DB networking
#   issues and works regardless of which host ports the DBs are mapped to.
#
# IDEMPOTENT: Uses ON CONFLICT DO NOTHING — safe to re-run at any time.
#
# USAGE:
#   ./scripts/seed.sh
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IDENTITY_CONTAINER="${IDENTITY_DB_CONTAINER:-triotect-identity-db}"
IDENTITY_USER="${IDENTITY_DB_USER:-identity_user}"
IDENTITY_DB_NAME="${IDENTITY_DB_NAME:-identity_db}"

STOCK_CONTAINER="${STOCK_DB_CONTAINER:-triotect-stock-db}"
STOCK_USER="${STOCK_DB_USER:-stock_user}"
STOCK_DB_NAME="${STOCK_DB_NAME:-stock_db}"

echo ""
echo "============================================================"
echo " TrioTect — Seed Script (Config Data)"
echo "============================================================"

# ── Wait for databases to be ready ────────────────────────────────────────────
echo ""
echo "── Waiting for databases to be ready ──"
until docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -c "SELECT 1" -q >/dev/null 2>&1; do
    echo "   identity-db: waiting..."; sleep 3
done
echo "   identity-db: ready ✅"

until docker exec "$STOCK_CONTAINER" psql -U "$STOCK_USER" -d "$STOCK_DB_NAME" -c "SELECT 1" -q >/dev/null 2>&1; do
    echo "   stock-db: waiting..."; sleep 3
done
echo "   stock-db: ready ✅"

# ── Seed users ─────────────────────────────────────────────────────────────────
echo ""
echo "── Seeding users (1 admin + 5 students) ──"
docker cp "${SCRIPT_DIR}/seed_users.sql" "${IDENTITY_CONTAINER}:/tmp/seed_users.sql"
docker exec "$IDENTITY_CONTAINER" psql -U "$IDENTITY_USER" -d "$IDENTITY_DB_NAME" -f /tmp/seed_users.sql

# ── Seed menu + inventory ──────────────────────────────────────────────────────
echo ""
echo "── Seeding menu items + inventory ──"
docker cp "${SCRIPT_DIR}/seed_menu.sql" "${STOCK_CONTAINER}:/tmp/seed_menu.sql"
docker exec "$STOCK_CONTAINER" psql -U "$STOCK_USER" -d "$STOCK_DB_NAME" -f /tmp/seed_menu.sql

echo ""
echo "============================================================"
echo " ✅ Seed complete!"
echo ""
echo " Default accounts:"
echo "   Admin:   ADMIN-001        / AdminPass123!"
echo "   Student: STU-2021-001     / Student1Pass!"
echo "            STU-2021-002     / Student2Pass!"
echo "            STU-2021-003     / Student3Pass!"
echo "            STU-2021-004     / Student4Pass!"
echo "            STU-2021-005     / Student5Pass!"
echo ""
echo " Login endpoint:  POST http://localhost:8001/auth/login"
echo " Run ./scripts/health-check.sh to verify all services."
echo "============================================================"
