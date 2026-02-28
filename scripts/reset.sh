#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/reset.sh
# Cleanly resets TRANSACTIONAL data while preserving CONFIGURATION data.
# Restarts all services.
#
# 🔴 TRANSACTIONAL DATA cleared:
#   - orders, order_items (kitchen-db)
#   - stock_deduction_log (stock-db)
#   - inventory.current_stock reset to initial_stock values
#   - Redis: idempotency keys, rate limit counters, stock cache, queue messages
#   - Celery task results in Redis
#
# 🟢 CONFIG DATA preserved:
#   - users (identity-db)
#   - menu_items (stock-db)
#   - inventory.initial_stock values
#   - Grafana dashboards/settings
#   - Prometheus data
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env from local deploy directory
ENV_FILE="${ROOT_DIR}/deploy/local/.env"
if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

COMPOSE_FILE="${ROOT_DIR}/deploy/local/docker-compose.yml"
DC="docker compose -f ${COMPOSE_FILE}"

echo "============================================================"
echo " TrioTect — Data Reset Script"
echo " Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"
echo ""
echo "🔴 Will CLEAR transactional data (orders, logs, cache keys)"
echo "🟢 Will PRESERVE config data (users, menu items, initial stock)"
echo ""
read -p "Are you sure you want to proceed? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "── Step 1: Stopping services (keeping databases and Redis up) ──"
$DC stop order-gateway stock-service kitchen-queue kitchen-worker notification-hub identity-provider student-ui admin-dashboard

echo ""
echo "── Step 2: Clearing Redis transactional keys ──"
$DC exec -T redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} --no-auth-warning \
    eval "
    local keys = redis.call('keys', 'idempotent:*')
    for _, k in ipairs(keys) do redis.call('del', k) end
    keys = redis.call('keys', 'ratelimit:*')
    for _, k in ipairs(keys) do redis.call('del', k) end
    keys = redis.call('keys', 'stock:*')
    for _, k in ipairs(keys) do redis.call('del', k) end
    keys = redis.call('keys', 'celery*')
    for _, k in ipairs(keys) do redis.call('del', k) end
    keys = redis.call('keys', 'order:*')
    for _, k in ipairs(keys) do redis.call('del', k) end
    return 'cleared'
    " 0 || echo "Warning: Could not run Redis cleanup (service may be down)"

echo "   ✅ Redis transactional keys cleared"

echo ""
echo "── Step 3: Clearing Kitchen DB transactional tables ──"
$DC exec -T kitchen-db psql \
    -U "${KITCHEN_DB_USER:-kitchen_user}" \
    -d "${KITCHEN_DB_NAME:-kitchen_db}" \
    -c "TRUNCATE TABLE orders, order_items RESTART IDENTITY CASCADE;" 2>/dev/null || \
    echo "   ⚠️  Could not truncate kitchen tables (may not exist yet)"
echo "   ✅ Kitchen DB transactional tables cleared"

echo ""
echo "── Step 4: Clearing Stock DB transactional log ──"
$DC exec -T stock-db psql \
    -U "${STOCK_DB_USER:-stock_user}" \
    -d "${STOCK_DB_NAME:-stock_db}" \
    -c "TRUNCATE TABLE stock_deduction_log RESTART IDENTITY CASCADE;" 2>/dev/null || \
    echo "   ⚠️  Could not truncate stock_deduction_log (may not exist yet)"
echo "   ✅ Stock deduction log cleared"

echo ""
echo "── Step 5: Resetting inventory to initial_stock values ──"
$DC exec -T stock-db psql \
    -U "${STOCK_DB_USER:-stock_user}" \
    -d "${STOCK_DB_NAME:-stock_db}" \
    -c "UPDATE inventory SET current_stock = initial_stock, version_id = 1, updated_at = NOW();" 2>/dev/null || \
    echo "   ⚠️  Could not reset inventory (table may not exist yet)"
echo "   ✅ Inventory quantities reset to initial_stock"

echo ""
echo "── Step 6: Restarting all services ──"
$DC up -d

echo ""
echo "── Step 7: Waiting for services to be healthy ──"
sleep 10
"${SCRIPT_DIR}/health-check.sh" || true

echo ""
echo "============================================================"
echo " ✅ Reset complete!"
echo " 🔴 Transactional data cleared: orders, logs, cache, queues"
echo " 🟢 Config data preserved: users, menu items, initial stock"
echo "============================================================"
