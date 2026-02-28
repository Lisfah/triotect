#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# scripts/health-check.sh
# Polls all 5 microservice /health endpoints and reports status.
# ──────────────────────────────────────────────────────────────────────────────
# Note: no set -e so we continue checking all services even if some are down

SERVICES=(
    "identity-provider|http://localhost:8001/health"
    "order-gateway|http://localhost:8002/health"
    "stock-service|http://localhost:8003/health"
    "kitchen-queue|http://localhost:8004/health"
    "notification-hub|http://localhost:8005/health"
)

echo ""
echo "============================================================"
echo " TrioTect — Service Health Check — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"

ALL_OK=true
for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name url <<< "$entry"
    # Use printf so \n is a real newline (single-quote echo does NOT expand \n)
    response=$(curl -sf -w "\n%{http_code}" --max-time 5 "$url" 2>/dev/null || printf '{"status":"unreachable"}\n000')
    http_code=$(printf '%s' "$response" | tail -1)
    body=$(printf '%s' "$response" | head -1)
    status=$(printf '%s' "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unreachable")

    if [[ "$http_code" == "200" ]]; then
        echo " ✅  $(printf '%-22s' "$name") HTTP $http_code  status: $status"
    else
        echo " ❌  $(printf '%-22s' "$name") HTTP $http_code  status: $status"
        ALL_OK=false
    fi
done

echo "============================================================"
if $ALL_OK; then
    echo " 🟢 All services are healthy!"
    exit 0
else
    echo " 🔴 One or more services are degraded."
    exit 1
fi
