"use client";
import { useState, useEffect, useCallback } from "react";

const IDENTITY_URL =
  process.env.NEXT_PUBLIC_IDENTITY_URL || "http://localhost:8001";
const KITCHEN_URL =
  process.env.NEXT_PUBLIC_KITCHEN_URL || "http://localhost:8004";

const MENU_MAP: Record<string, { name: string; emoji: string }> = {
  "ITEM-BIRIYANI": { name: "Chicken Biriyani", emoji: "🍗" },
  "ITEM-KEBAB": { name: "Beef Kebab", emoji: "🥩" },
  "ITEM-HALEEM": { name: "Chicken Haleem", emoji: "🍲" },
  "ITEM-JUICE": { name: "Fruit Juice", emoji: "🧃" },
  "ITEM-DATE": { name: "Medjool Dates", emoji: "🫐" },
  "ITEM-SAMOSA": { name: "Samosa", emoji: "🥟" },
};

type OrderStatus =
  | "pending"
  | "stock_verified"
  | "in_kitchen"
  | "ready"
  | "failed";

interface OrderItem {
  menu_item_id: string;
  quantity: number;
}
interface KitchenOrder {
  order_id: string;
  student_id: string;
  status: OrderStatus;
  special_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  items: OrderItem[];
}

const COLUMNS: {
  status: OrderStatus;
  label: string;
  color: string;
  bg: string;
}[] = [
  {
    status: "pending",
    label: "⏳ Pending",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
  },
  {
    status: "stock_verified",
    label: "✅ Verified",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
  },
  {
    status: "in_kitchen",
    label: "👨‍🍳 In Kitchen",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
  },
  {
    status: "ready",
    label: "🍱 Ready",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.08)",
  },
];

function parseJwt(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    return null;
  }
}

function elapsed(iso: string | null): string {
  if (!iso) return "";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function KitchenPage() {
  const [token, setToken] = useState<string | null>(null);
  const [adminId, setAdminId] = useState("");

  // ── Restore session from localStorage on mount ───────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("admin_token");
    const savedId = localStorage.getItem("admin_id");
    if (saved && savedId) {
      const claims = parseJwt(saved);
      if (claims?.exp && (claims.exp as number) * 1000 > Date.now()) {
        setToken(saved);
        setAdminId(savedId);
      } else {
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_id");
      }
    }
  }, []);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [showChangePw, setShowChangePw] = useState(false);
  const [cpId, setCpId] = useState("");
  const [cpCurrentPw, setCpCurrentPw] = useState("");
  const [cpNewPw, setCpNewPw] = useState("");
  const [cpConfirmPw, setCpConfirmPw] = useState("");
  const [cpError, setCpError] = useState("");
  const [cpSuccess, setCpSuccess] = useState("");
  const [cpLoading, setCpLoading] = useState(false);

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());

  // ── Change Password ──────────────────────────────────────────────────────────
  const handleChangePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpError("");
    setCpSuccess("");
    if (cpNewPw !== cpConfirmPw) {
      setCpError("New passwords do not match.");
      return;
    }
    if (cpNewPw.length < 6) {
      setCpError("New password must be at least 6 characters.");
      return;
    }
    setCpLoading(true);
    try {
      const r = await fetch(`${IDENTITY_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: cpId,
          current_password: cpCurrentPw,
          new_password: cpNewPw,
        }),
      });
      if (!r.ok) {
        if (r.status === 422) {
          const data = await r.json();
          const msg = data.detail?.[0]?.msg ?? data.detail ?? "Invalid input.";
          setCpError(typeof msg === "string" ? msg : JSON.stringify(msg));
        } else {
          const data = await r.json();
          setCpError(data.detail || "Failed to change password.");
        }
        return;
      }
      setCpSuccess("✅ Password changed. Redirecting to login…");
      const idToFill = cpId;
      setCpId("");
      setCpCurrentPw("");
      setCpNewPw("");
      setCpConfirmPw("");
      setTimeout(() => {
        setLoginId(idToFill);
        setShowChangePw(false);
        setCpSuccess("");
      }, 1500);
    } catch {
      setCpError("Network error. Please try again.");
    } finally {
      setCpLoading(false);
    }
  };

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const r = await fetch(`${IDENTITY_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: loginId, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setLoginError(
          r.status === 429
            ? `⏱ Too many attempts. Retry in ${data.retry_after_seconds}s.`
            : data.detail || "Login failed.",
        );
        return;
      }
      const claims = parseJwt(data.access_token);
      if (!claims?.is_admin) {
        setLoginError("Access denied: administrator account required.");
        return;
      }
      setToken(data.access_token);
      setAdminId(loginId);
      localStorage.setItem("admin_token", data.access_token);
      localStorage.setItem("admin_id", loginId);
    } catch {
      setLoginError("Network error. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Fetch all orders ─────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${KITCHEN_URL}/kitchen/all-orders`);
      if (r.ok) {
        const fresh: KitchenOrder[] = await r.json();
        setOrders((prev) => {
          const existingIds = new Set(prev.map((o) => o.order_id));
          const incoming = new Set(fresh.map((o) => o.order_id));
          const brandNew = [...incoming].filter((id) => !existingIds.has(id));
          if (brandNew.length > 0) {
            setNewOrderIds((ids) => {
              const next = new Set(ids);
              brandNew.forEach((id) => next.add(id));
              return next;
            });
            // Clear highlight after 3s
            setTimeout(() => {
              setNewOrderIds((ids) => {
                const next = new Set(ids);
                brandNew.forEach((id) => next.delete(id));
                return next;
              });
            }, 3000);
          }
          return fresh;
        });
        setLastRefresh(new Date().toLocaleTimeString());
      }
    } catch {}
    setLoading(false);
  }, []);

  // ── Manually advance / revert an order ───────────────────────────────────
  const moveOrder = useCallback(
    async (orderId: string, direction: "advance" | "revert") => {
      try {
        await fetch(`${KITCHEN_URL}/kitchen/orders/${orderId}/${direction}`, {
          method: "POST",
        });
        await fetchOrders();
      } catch {}
    },
    [fetchOrders],
  );

  useEffect(() => {
    if (!token) return;
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [token, fetchOrders]);

  const activeOrders = orders.filter(
    (o) => o.status !== "failed" && o.status !== "ready",
  );
  const readyOrders = orders.filter((o) => o.status === "ready");
  const failedOrders = orders.filter((o) => o.status === "failed");

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <main className="container" style={{ paddingTop: "4rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              background: "linear-gradient(135deg, #6C63FF, #FF6584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            🍳 Kitchen Order Board
          </h1>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem" }}>
            IUT Cafeteria — Live Order Display
          </p>
        </div>
        <div
          className="card animate-fade-in"
          style={{ maxWidth: "420px", margin: "0 auto" }}
        >
          <h2
            style={{
              marginBottom: "1.5rem",
              fontSize: "1.15rem",
              fontWeight: 600,
            }}
          >
            {showChangePw ? "🔑 Change Password" : "🔐 Administrator Login"}
          </h2>
          {showChangePw ? (
            <form
              onSubmit={handleChangePw}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.1rem",
              }}
            >
              {(
                [
                  ["Admin ID", cpId, setCpId, "text", "ADMIN-001"],
                  [
                    "Current Password",
                    cpCurrentPw,
                    setCpCurrentPw,
                    "password",
                    "••••••••",
                  ],
                  ["New Password", cpNewPw, setCpNewPw, "password", "••••••••"],
                  [
                    "Confirm New Password",
                    cpConfirmPw,
                    setCpConfirmPw,
                    "password",
                    "••••••••",
                  ],
                ] as [string, string, (v: string) => void, string, string][]
              ).map(([lbl, val, setter, type, ph]) => (
                <div key={lbl}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.4rem",
                      fontSize: "0.875rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {lbl}
                  </label>
                  <input
                    type={type}
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={ph}
                    required
                    style={{
                      width: "100%",
                      padding: "0.625rem 0.875rem",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid var(--card-border)",
                      borderRadius: "8px",
                      color: "var(--text)",
                      fontSize: "0.95rem",
                      outline: "none",
                    }}
                  />
                </div>
              ))}
              {cpError && (
                <p
                  style={{
                    color: "var(--danger)",
                    fontSize: "0.875rem",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(239,68,68,0.08)",
                    borderRadius: "6px",
                    border: "1px solid rgba(239,68,68,0.2)",
                  }}
                >
                  ❌ {cpError}
                </p>
              )}
              {cpSuccess && (
                <p
                  style={{
                    color: "var(--success)",
                    fontSize: "0.875rem",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(34,197,94,0.08)",
                    borderRadius: "6px",
                    border: "1px solid rgba(34,197,94,0.2)",
                  }}
                >
                  {cpSuccess}
                </p>
              )}
              <button
                className="btn btn-primary"
                type="submit"
                disabled={cpLoading}
                style={{ justifyContent: "center", fontSize: "0.95rem" }}
              >
                {cpLoading ? (
                  <span className="animate-pulse">Changing…</span>
                ) : (
                  "Change Password"
                )}
              </button>
              <p style={{ textAlign: "center", marginTop: "0.25rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowChangePw(false);
                    setCpError("");
                    setCpSuccess("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: "0.75rem",
                  }}
                >
                  ← Back to Login
                </button>
              </p>
            </form>
          ) : (
            <form
              onSubmit={handleLogin}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.1rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.4rem",
                    fontSize: "0.875rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Admin ID
                </label>
                <input
                  id="admin-id"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="ADMIN-001"
                  required
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.95rem",
                    outline: "none",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.4rem",
                    fontSize: "0.875rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.875rem",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    color: "var(--text)",
                    fontSize: "0.95rem",
                    outline: "none",
                  }}
                />
              </div>
              {loginError && (
                <p
                  style={{
                    color: "var(--danger)",
                    fontSize: "0.875rem",
                    padding: "0.5rem 0.75rem",
                    background: "rgba(239,68,68,0.08)",
                    borderRadius: "6px",
                    border: "1px solid rgba(239,68,68,0.2)",
                  }}
                >
                  ❌ {loginError}
                </p>
              )}
              <button
                id="login-btn"
                className="btn btn-primary"
                type="submit"
                disabled={loginLoading}
                style={{ justifyContent: "center", fontSize: "0.95rem" }}
              >
                {loginLoading ? (
                  <span className="animate-pulse">Authenticating…</span>
                ) : (
                  "View Kitchen Board →"
                )}
              </button>
            </form>
          )}
          {!showChangePw && (
            <p style={{ textAlign: "center", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => {
                  setShowChangePw(true);
                  setLoginError("");
                  setCpError("");
                  setCpSuccess("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  fontSize: "0.75rem",
                }}
              >
                Change Password
              </button>
            </p>
          )}
        </div>
      </main>
    );
  }

  // ── Kitchen Board ─────────────────────────────────────────────────────────────
  return (
    <main
      className="container"
      style={{ paddingTop: "2rem", paddingBottom: "4rem" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              background: "linear-gradient(135deg, #6C63FF, #FF6584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            🍳 Kitchen Order Board
          </h1>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.875rem",
              marginTop: "0.25rem",
            }}
          >
            Live feed · Auto-refreshes every 5s · 👤 {adminId}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Last refresh: {lastRefresh}
          </span>
          <a
            href="/admin"
            className="btn btn-primary"
            style={{
              fontSize: "0.875rem",
              padding: "0.5rem 1rem",
              textDecoration: "none",
            }}
          >
            ← Console
          </a>
          <button
            className="btn btn-danger"
            onClick={() => {
              setToken(null);
              setAdminId("");
              localStorage.removeItem("admin_token");
              localStorage.removeItem("admin_id");
            }}
            style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "2rem",
          flexWrap: "wrap",
        }}
      >
        {[
          {
            label: "Active",
            val: activeOrders.length,
            color: "var(--warning)",
          },
          { label: "Ready", val: readyOrders.length, color: "var(--success)" },
          { label: "Failed", val: failedOrders.length, color: "var(--danger)" },
          { label: "Total", val: orders.length, color: "var(--primary)" },
        ].map(({ label, val, color }) => (
          <div
            key={label}
            className="card"
            style={{ flex: "1", minWidth: "100px", textAlign: "center" }}
          >
            <div
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: "2rem",
                fontWeight: 700,
                color,
              }}
            >
              {val}
            </div>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "0.8rem",
                marginTop: "0.4rem",
              }}
            >
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Kanban columns: Pending · Verified · In Kitchen · Ready */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.status === col.status);
          return (
            <div key={col.status}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                <h2
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: col.color,
                  }}
                >
                  {col.label}
                </h2>
                <span
                  style={{
                    fontSize: "0.75rem",
                    background: col.bg,
                    color: col.color,
                    borderRadius: "999px",
                    padding: "0.1rem 0.5rem",
                    border: `1px solid ${col.color}44`,
                  }}
                >
                  {colOrders.length}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                  minHeight: "120px",
                }}
              >
                {colOrders.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "1.5rem 0",
                      color: "var(--text-muted)",
                      fontSize: "0.8rem",
                      border: "1px dashed var(--card-border)",
                      borderRadius: "8px",
                    }}
                  >
                    — empty —
                  </div>
                ) : (
                  colOrders.map((order) => (
                    <OrderCard
                      key={order.order_id}
                      order={order}
                      color={col.color}
                      bg={col.bg}
                      isNew={newOrderIds.has(order.order_id)}
                      onAdvance={() => moveOrder(order.order_id, "advance")}
                      onRevert={() => moveOrder(order.order_id, "revert")}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Failed orders (collapsed at bottom) */}
      {failedOrders.length > 0 && (
        <div className="card" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
          <h2
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--danger)",
              marginBottom: "0.75rem",
            }}
          >
            ❌ Failed Orders ({failedOrders.length})
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {failedOrders.map((order) => (
              <div
                key={order.order_id}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.3rem 0.6rem",
                  borderRadius: "6px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: "var(--danger)",
                }}
              >
                #{order.order_id.slice(-8)} · {order.student_id.slice(-9)}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && orders.length === 0 && (
        <p
          style={{
            textAlign: "center",
            color: "var(--text-muted)",
            marginTop: "3rem",
          }}
        >
          Loading orders…
        </p>
      )}
    </main>
  );
}

// ── Order Card component ───────────────────────────────────────────────────────
function OrderCard({
  order,
  color,
  bg,
  isNew,
  onAdvance,
  onRevert,
}: {
  order: KitchenOrder;
  color: string;
  bg: string;
  isNew: boolean;
  onAdvance: () => void;
  onRevert: () => void;
}) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const handleAdvance = async () => {
    if (busy) return;
    setBusy(true);
    await onAdvance();
    setBusy(false);
  };

  const handleRevert = async () => {
    if (busy) return;
    setBusy(true);
    await onRevert();
    setBusy(false);
  };

  const canAdvance = order.status !== "ready" && order.status !== "failed";
  const canRevert =
    order.status === "stock_verified" ||
    order.status === "in_kitchen" ||
    order.status === "ready";

  return (
    <div
      className={isNew ? "animate-fade-in" : ""}
      style={{
        background: isNew ? bg : "var(--card)",
        border: `1px solid ${isNew ? color : "var(--card-border)"}`,
        borderRadius: "10px",
        padding: "0.75rem",
        transition: "all 0.4s ease",
        boxShadow: isNew ? `0 0 12px ${color}44` : "none",
      }}
    >
      {/* Order ID + elapsed */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.4rem",
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontWeight: 600,
            fontSize: "0.8rem",
          }}
        >
          #{order.order_id.slice(-8)}
        </span>
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
          {elapsed(order.created_at)}
        </span>
      </div>

      {/* Student */}
      <div
        style={{
          fontSize: "0.78rem",
          color: "var(--text-muted)",
          marginBottom: "0.4rem",
        }}
      >
        👤 {order.student_id.slice(-9)}
      </div>

      {/* Items */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
        {order.items.map((it, i) => {
          const m = MENU_MAP[it.menu_item_id];
          return (
            <span
              key={i}
              style={{
                fontSize: "0.72rem",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--card-border)",
                borderRadius: "4px",
                padding: "0.1rem 0.35rem",
              }}
            >
              {m ? `${m.emoji} ${m.name}` : it.menu_item_id} ×{it.quantity}
            </span>
          );
        })}
      </div>

      {/* Notes */}
      {order.special_notes && (
        <div
          style={{
            marginTop: "0.35rem",
            fontSize: "0.72rem",
            color: "var(--warning)",
            fontStyle: "italic",
          }}
        >
          📝 {order.special_notes}
        </div>
      )}

      {/* Action button */}
      {(canAdvance || canRevert) && (
        <div
          style={{
            display: "flex",
            justifyContent:
              canAdvance && canRevert
                ? "space-between"
                : canRevert
                  ? "flex-start"
                  : "flex-end",
            marginTop: "0.5rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid var(--card-border)",
          }}
        >
          {canRevert && (
            <button
              onClick={handleRevert}
              disabled={busy}
              title="Revert to previous stage"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "6px",
                color: "var(--danger)",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                padding: "0.25rem 0.65rem",
                opacity: busy ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {busy ? "…" : "←"}
            </button>
          )}
          {canAdvance && (
            <button
              onClick={handleAdvance}
              disabled={busy}
              title="Advance to next stage"
              style={{
                background: "rgba(34,197,94,0.1)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: "6px",
                color: "#22c55e",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: "1rem",
                lineHeight: 1,
                padding: "0.25rem 0.65rem",
                opacity: busy ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              {busy ? "…" : "→"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
