"""
TrioTect Integration Tests

Tests:
  1. Order Gateway auth enforcement (401 on missing JWT)
  2. Redis cache stock check (400 when stock=0 in cache)
  3. Idempotency key deduplication
  4. Stock Service optimistic locking (concurrent deductions don't oversell)
  5. Identity Provider rate limiting (429 after 3 attempts)
"""
import asyncio
import uuid
import pytest
import pytest_asyncio
import httpx
import redis.asyncio as aioredis

# ─── Config ────────────────────────────────────────────────────────────────────
IDENTITY_URL = "http://localhost:8001"
GATEWAY_URL = "http://localhost:8002"
STOCK_URL = "http://localhost:8003"
NOTIFICATION_URL = "http://localhost:8005"
REDIS_URL = "redis://localhost:6379"


# ─── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def redis_client():
    client = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield client
    await client.aclose()


@pytest_asyncio.fixture(scope="session")
async def student_token():
    """Get a valid JWT for a test student."""
    async with httpx.AsyncClient() as client:
        # Register test student (may already exist)
        await client.post(
            f"{IDENTITY_URL}/auth/register",
            json={
                "student_id": "TEST-STUDENT-001",
                "email": "test_student_001@iut.edu.bd",
                "password": "TestPass123!",
                "full_name": "Test Student",
                "is_admin": False,
            },
        )
        # Login
        r = await client.post(
            f"{IDENTITY_URL}/auth/login",
            json={"student_id": "TEST-STUDENT-001", "password": "TestPass123!"},
        )
        assert r.status_code == 200, f"Login failed: {r.text}"
        return r.json()["access_token"]


# ─── Test 1: JWT Auth Enforcement ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_gateway_rejects_unauthenticated_request():
    """Order Gateway must return 401 when Authorization header is missing."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{GATEWAY_URL}/orders",
            json={"items": [{"menu_item_id": "ITEM-BIRIYANI", "quantity": 1}]},
        )
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_gateway_rejects_invalid_jwt():
    """Order Gateway must return 401 for a tampered JWT."""
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{GATEWAY_URL}/orders",
            json={"items": [{"menu_item_id": "ITEM-BIRIYANI", "quantity": 1}]},
            headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.INVALID.SIGNATURE"},
        )
    assert r.status_code == 401


# ─── Test 2: Redis Cache Stock Check ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_gateway_rejects_order_when_cache_shows_zero(redis_client, student_token):
    """
    When Redis cache shows stock=0 for an item, Gateway must return 400
    without ever calling Stock Service.
    """
    menu_item_id = f"CACHE-TEST-{uuid.uuid4().hex[:8]}"
    cache_key = f"stock:{menu_item_id}"
    await redis_client.setex(cache_key, 60, "0")  # Seed cache with 0 stock

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{GATEWAY_URL}/orders",
            json={"items": [{"menu_item_id": menu_item_id, "quantity": 1}]},
            headers={"Authorization": f"Bearer {student_token}"},
        )
    assert r.status_code == 400, f"Expected 400 (out of stock), got {r.status_code}: {r.text}"

    # Cleanup
    await redis_client.delete(cache_key)


# ─── Test 3: Idempotency Key ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_idempotency_key_prevents_duplicate_processing(redis_client, student_token):
    """
    Sending the same Idempotency-Key twice should return the cached response
    on the second call without re-processing.
    """
    idem_key = str(uuid.uuid4())
    cache_key = f"idempotent:{idem_key}"

    # Pre-seed the idempotency cache to simulate a completed request
    import json
    await redis_client.setex(
        cache_key,
        86400,
        json.dumps({
            "body": {"order_id": "pre-cached-order", "status": "queued", "message": "Cached"},
            "status_code": 202,
        }),
    )

    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{GATEWAY_URL}/orders",
            json={"items": [{"menu_item_id": "ITEM-BIRIYANI", "quantity": 1}]},
            headers={
                "Authorization": f"Bearer {student_token}",
                "Idempotency-Key": idem_key,
            },
        )

    assert r.status_code == 202
    assert r.headers.get("X-Idempotency-Replay") == "true"
    body = r.json()
    assert body["order_id"] == "pre-cached-order"

    # Cleanup
    await redis_client.delete(cache_key)


# ─── Test 4: Optimistic Locking — Concurrent Deductions ────────────────────────
@pytest.mark.asyncio
async def test_optimistic_locking_prevents_overselling():
    """
    Send 20 concurrent deduction requests for an item with stock=5.
    Exact 5 should succeed; subsequent requests should fail with 409.
    Total deductions must never exceed 5 (the initial stock).
    """
    import sqlalchemy
    from sqlalchemy import create_engine, text

    # Skip if stock DB isn't accessible
    try:
        engine = create_engine(
            "postgresql://stock_user:stock_pass@localhost:5433/stock_db", pool_pre_ping=True
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        pytest.skip("Stock DB not accessible from test environment")

    menu_item_id = f"CONCURRENCY-TEST-{uuid.uuid4().hex[:8]}"
    INITIAL_STOCK = 5

    # Seed test inventory
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO inventory (id, menu_item_id, current_stock, initial_stock, version_id) "
                "VALUES (gen_random_uuid()::text, :mid, :stock, :stock, 1) "
                "ON CONFLICT (menu_item_id) DO UPDATE SET current_stock=:stock, version_id=1"
            ),
            {"mid": menu_item_id, "stock": INITIAL_STOCK},
        )

    # Fire 20 concurrent deduction requests
    async def deduct_one(session: httpx.AsyncClient, order_id: str):
        return await session.post(
            f"{STOCK_URL}/stock/deduct",
            json={
                "order_id": order_id,
                "student_id": "CONCURRENCY-TESTER",
                "items": [{"menu_item_id": menu_item_id, "quantity": 1}],
            },
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [deduct_one(client, str(uuid.uuid4())) for _ in range(20)]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    successes = [r for r in responses if not isinstance(r, Exception) and r.status_code == 200]
    failures = [r for r in responses if not isinstance(r, Exception) and r.status_code == 409]

    # Verify: exactly INITIAL_STOCK successes
    assert len(successes) == INITIAL_STOCK, (
        f"Expected {INITIAL_STOCK} successful deductions but got {len(successes)}. "
        f"Optimistic locking may be broken!"
    )
    assert len(failures) == 20 - INITIAL_STOCK

    # Verify DB final stock is exactly 0
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT current_stock FROM inventory WHERE menu_item_id = :mid"),
            {"mid": menu_item_id},
        ).fetchone()
        assert row is not None
        assert row[0] == 0, f"DB shows {row[0]} remaining stock, expected 0!"

    # Cleanup
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM inventory WHERE menu_item_id = :mid"), {"mid": menu_item_id})


# ─── Test 5: Rate Limiting ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_rate_limiter_blocks_after_max_attempts(redis_client):
    """
    Sending >3 login requests for the same student_id within 60s must
    return HTTP 429 on the 4th attempt.
    """
    student_id = f"RATE-LIMIT-TEST-{uuid.uuid4().hex[:8]}"
    # Clear any existing rate limit keys
    await redis_client.delete(f"ratelimit:{student_id}")

    async with httpx.AsyncClient() as client:
        responses = []
        for _ in range(4):
            r = await client.post(
                f"{IDENTITY_URL}/auth/login",
                json={"student_id": student_id, "password": "wrong_password"},
            )
            responses.append(r)

    # First 3 should be 401 (wrong password), 4th should be 429
    assert all(r.status_code in (401, 422) for r in responses[:3])
    assert responses[3].status_code == 429, (
        f"Expected 429 on 4th attempt, got {responses[3].status_code}"
    )
    assert "Retry-After" in responses[3].headers

    # Cleanup
    await redis_client.delete(f"ratelimit:{student_id}")


# ─── Test 6: Health Endpoints ───────────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    f"{IDENTITY_URL}/health",
    f"{GATEWAY_URL}/health",
    f"{STOCK_URL}/health",
    f"{NOTIFICATION_URL}/health",
])
async def test_all_health_endpoints_return_200(url):
    """All services must expose a /health endpoint returning 200."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(url)
    assert r.status_code == 200, f"{url} returned {r.status_code}"
    body = r.json()
    assert "status" in body
    assert body["status"] == "healthy"
