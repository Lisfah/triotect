# TrioTect — IUT Cafeteria Distributed Microservices Platform

> **Team:** 3 Stooges  
> **Stack:** FastAPI · PostgreSQL · Redis · Next.js · Prometheus · Grafana · Docker

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      Nginx / Reverse Proxy               │
│              (SSL Termination · Load Balancing)          │
└────────┬──────────┬──────────┬──────────────────────────┘
         │          │          │
   Student UI  Admin UI   API Traffic
   (Next.js)  (Next.js)       │
                         ┌─────▼──────────┐
                         │  Order Gateway  │  ←── JWT Auth
                         │  (FastAPI)      │  ←── Redis Cache Check
                         │                │  ←── Idempotency Key
                         └─────┬──────────┘
                               │
               ┌───────────────┼──────────────┐
               │               │              │
       ┌───────▼──────┐ ┌─────▼──────┐ ┌────▼──────────┐
       │ Identity     │ │  Stock      │ │ Kitchen Queue  │
       │ Provider     │ │  Service    │ │ (Celery/Redis) │
       │ (FastAPI)    │ │  (FastAPI)  │ └────┬──────────┘
       │ Rate Limiter │ │ Opt. Lock   │      │
       └──────────────┘ └─────────────┘      │
                                      ┌──────▼──────────┐
                                      │ Notification Hub │
                                      │ (FastAPI SSE)    │
                                      └──────────────────┘

Infrastructure: PostgreSQL × N · Redis · Prometheus · Grafana
```

## Services & Ports

| Service             | Port (Local) | Description                      |
| ------------------- | ------------ | -------------------------------- |
| Identity Provider   | 8001         | JWT auth + rate limiting         |
| Order Gateway       | 8002         | API facade + cache + idempotency |
| Stock Service       | 8003         | Inventory + optimistic locking   |
| Kitchen Queue       | 8004         | Async order processing (Celery)  |
| Notification Hub    | 8005         | SSE real-time push updates       |
| Student UI          | 3000         | Next.js student-facing app       |
| Admin Dashboard     | 3001         | Next.js admin/monitoring app     |
| Prometheus          | 9090         | Metrics aggregation              |
| Grafana             | 3002         | Dashboards & alerting            |
| Redis               | 6379         | Cache + message broker           |
| Postgres (Identity) | **5437**     | User DB ¹                        |
| Postgres (Stock)    | **5435**     | Inventory DB ¹                   |
| Postgres (Kitchen)  | **5436**     | Order DB ¹                       |

> ¹ Host ports remapped from defaults (5432/5433/5434) to avoid conflicts with any
> existing PostgreSQL instances on the host machine.

## Quick Start (Local Dev)

```bash
# 1. Clone & navigate
cd triotect

# 2. Copy & configure environment
cp deploy/local/.env.example deploy/local/.env
# Review deploy/local/.env — defaults work for local dev out of the box

# 3. Generate self-signed SSL certs for localhost
./scripts/generate-certs.sh local

# 4. Start all services
docker compose -f deploy/local/docker-compose.yml up -d --build

# 5. Seed initial data (admin account, students, menu + inventory)
./scripts/seed.sh

# 6. Verify all services are up
./scripts/health-check.sh
```

Access the platform at:

- **https://localhost** — Student UI (accept browser SSL warning for self-signed cert)
- **https://localhost/admin/** — Admin Dashboard
- **https://localhost/admin/kitchen** — Kitchen Order Processing Board
- **https://localhost/api/health** — API Gateway health
- **http://localhost:3002** — Grafana (`admin` / `grafana_pass_local` for local dev; change via `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` in `.env`)
- **http://localhost:9090** — Prometheus

---

## Kitchen Order Processing Page

The **Kitchen Order Board** (`/admin/kitchen`) is a live Kanban display for kitchen staff to monitor order pipeline status.

### How to navigate there

1. Open the Admin Dashboard: **https://localhost/admin/**
2. Log in with an administrator account (e.g. `ADMIN-001` / `AdminPass123!`).
3. Click the **🍳 Kitchen Board** button in the top-right action bar.

Alternatively, navigate directly to **https://localhost/admin/kitchen** — the page has its own login form requiring an admin account.

### What it shows

| Column        | Status                                       | Colour |
| ------------- | -------------------------------------------- | ------ |
| ⏳ Pending    | `pending` — order received, not yet verified | Amber  |
| ✅ Verified   | `stock_verified` — stock confirmed           | Blue   |
| 👨‍🍳 In Kitchen | `in_kitchen` — being prepared                | Purple |
| 🍱 Ready      | `ready` — ready for pick-up                  | Green  |

A summary strip above the board shows **Active / Ready / Failed / Total** counts. Failed orders are collapsed into a section at the bottom. The board auto-refreshes every **5 seconds** and highlights newly arrived orders for 3 seconds.

### Direct URL (local dev without Nginx)

If services are running without the Nginx reverse proxy:

- Kitchen Board: **http://localhost:3001/admin/kitchen**
- Calls the Identity Provider at `http://localhost:8001` and the Kitchen Queue at `http://localhost:8004` directly from the browser (both ports are exposed in `deploy/local/docker-compose.yml`).

---

## Default Seed Accounts

The `./scripts/seed.sh` creates these accounts on first run:

| Role      | Student ID  | Password        | Email               |
| --------- | ----------- | --------------- | ------------------- |
| **Admin** | `ADMIN-001` | `AdminPass123!` | admin@iut.edu.bd    |
| Student   | `210041001` | `Student1Pass!` | student1@iut.edu.bd |
| Student   | `210041002` | `Student2Pass!` | student2@iut.edu.bd |
| Student   | `210041003` | `Student3Pass!` | student3@iut.edu.bd |
| Student   | `210041004` | `Student4Pass!` | student4@iut.edu.bd |
| Student   | `210041005` | `Student5Pass!` | student5@iut.edu.bd |

### ID Format Rules

| Account Type | Format | Example | Constraint |
| ------------ | ------ | ------- | ---------- |
| **Admin**    | Alphanumeric string | `ADMIN-001` | 1–64 characters, any format |
| **Student**  | 9-digit IUT number | `210041001` | Exactly 9 digits (enforced by `create-student.sh` and the UI) |

### Grafana

| Service                 | Username | Password             | URL                   |
| ----------------------- | -------- | -------------------- | --------------------- |
| **Grafana** (local dev) | `admin`  | `grafana_pass_local` | http://localhost:3002 |

> Change via `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` in `deploy/local/.env` before deploying to staging/production.

### Seed Menu Items

| Item              | Price (৳) | Category | Initial Stock |
| ----------------- | --------- | -------- | ------------- |
| Chicken Biriyani  | 450       | main     | 100           |
| Beef Kebab        | 350       | main     | 80            |
| Chicken Haleem    | 300       | main     | 60            |
| Mixed Fruit Juice | 80        | beverage | 200           |
| Medjool Dates     | 150       | snack    | 150           |
| Vegetable Samosa  | 50        | snack    | 300           |

> **Note:** `seed.sh` is idempotent — re-running it skips already-existing records
> (`ON CONFLICT DO NOTHING`). Safe to run multiple times.

### Registration & Account Management API

```bash
# Register a student (9-digit ID required)
curl -s -X POST http://localhost:8001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"student_id":"210041001","email":"you@iut.edu.bd",
       "password":"YourPass123","full_name":"Your Name","is_admin":false}'

# Login (students and admins use the same endpoint)
curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"student_id":"210041001","password":"YourPass123"}'

# Change password
curl -s -X POST http://localhost:8001/auth/change-password \
  -H "Content-Type: application/json" \
  -d '{"student_id":"210041001","current_password":"YourPass123","new_password":"NewPass456"}'
```

> The change-password form is also available directly on all login pages (Student UI, Admin Console, Kitchen Board) via the **"Change Password"** link.

---

## Data Classification

### 🔴 Transactional Data (reset with `scripts/reset.sh`)

- Orders, order items, order state transitions
- Stock deduction logs
- JWT refresh tokens
- Idempotency keys (Redis)
- Rate limit counters (Redis)
- Kitchen queue events (Redis)
- Notification pub/sub (Redis)

### 🟢 Configuration Data (preserved through resets)

- User accounts (students, admins)
- Menu items & pricing
- Initial stock quantities
- Grafana dashboard configs
- Prometheus alert rules

---

## Scripts

| Script                      | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `scripts/seed.sh`           | Seed admin, students, menu items + inventory                                 |
| `scripts/health-check.sh`   | Poll all `/health` endpoints and report status                               |
| `scripts/generate-certs.sh` | Generate SSL certs (`local` = self-signed, `staging`/`prod` = Let's Encrypt) |
| `scripts/reset.sh`          | Wipe transactional data, preserve config, restart services                   |
| `scripts/add-admin.sh`      | Interactively create a new admin account (any ID format)                     |
| `scripts/delete-admin.sh`   | Interactively delete an admin account (requires password confirmation)       |
| `scripts/list-admins.sh`    | List all admin accounts (ID, name, email, status)                            |
| `scripts/create-student.sh` | Interactively create a student account (enforces 9-digit IUT ID format)      |

---

## Deployment Environments

| Environment | Compose File                           | Notes                                            |
| ----------- | -------------------------------------- | ------------------------------------------------ |
| Local Dev   | `deploy/local/docker-compose.yml`      | Self-signed SSL, no replicas, direct port access |
| Staging     | `deploy/staging/docker-compose.yml`    | Self-signed SSL, single replicas                 |
| Production  | `deploy/production/docker-compose.yml` | Let's Encrypt SSL, Swarm replicas                |

Copy the appropriate `.env.example` → `.env` before deploying each environment.

---

## CI/CD

GitHub Actions pipeline in `.github/workflows/ci.yml`:

- Spins up Docker Compose test environment
- Runs pytest integration suite
- Blocks merge on any failure
