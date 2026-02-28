'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'http://localhost:8001';
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8002';
const NOTIFICATION_URL = process.env.NEXT_PUBLIC_NOTIFICATION_URL || 'http://localhost:8005';

type OrderStatus = 'pending' | 'stock_verified' | 'in_kitchen' | 'ready' | 'failed';

const STATUS_STEPS: OrderStatus[] = ['pending', 'stock_verified', 'in_kitchen', 'ready'];
const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '⏳ Pending',
  stock_verified: '✅ Verified',
  in_kitchen: '👨‍🍳 In Kitchen',
  ready: '🍱 Ready!',
  failed: '❌ Failed',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: '#f59e0b',
  stock_verified: '#3b82f6',
  in_kitchen: '#8b5cf6',
  ready: '#22c55e',
  failed: '#ef4444',
};

const MENU_ITEMS = [
  { id: 'ITEM-BIRIYANI', name: 'Chicken Biriyani', price: 450, emoji: '🍗' },
  { id: 'ITEM-KEBAB', name: 'Beef Kebab', price: 350, emoji: '🥩' },
  { id: 'ITEM-HALEEM', name: 'Chicken Haleem', price: 300, emoji: '🍲' },
  { id: 'ITEM-JUICE', name: 'Fruit Juice', price: 80, emoji: '🧃' },
  { id: 'ITEM-DATE', name: 'Medjool Dates', price: 150, emoji: '🫐' },
  { id: 'ITEM-SAMOSA', name: 'Samosa', price: 50, emoji: '🥟' },
];

const MENU_MAP: Record<string, { name: string; emoji: string }> = Object.fromEntries(
  MENU_ITEMS.map(i => [i.id, { name: i.name, emoji: i.emoji }])
);

interface OrderItem { menu_item_id: string; quantity: number; }
interface HistoryOrder {
  order_id: string;
  status: OrderStatus;
  created_at: string | null;
  special_notes: string | null;
  items: OrderItem[];
}

export default function StudentPage() {
  const [token, setToken] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [cart, setCart] = useState<{ [id: string]: number }>({});
  const [ordering, setOrdering] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [orderError, setOrderError] = useState('');

  const [orderHistory, setOrderHistory] = useState<HistoryOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const esRef = useRef<EventSource | null>(null);

  // ── Fetch order history ──────────────────────────────────────────────────────
  const fetchHistory = useCallback(async (jwt: string) => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`${GATEWAY_URL}/orders`, {
        headers: { 'Authorization': `Bearer ${jwt}` },
      });
      if (r.ok) setOrderHistory(await r.json());
    } catch {}
    finally { setHistoryLoading(false); }
  }, []);

  // Refresh history whenever a new order lands or on login
  useEffect(() => {
    if (token) fetchHistory(token);
  }, [token, orderId, fetchHistory]);

  // Also refresh when current order status changes to terminal state
  useEffect(() => {
    if (token && (orderStatus === 'ready' || orderStatus === 'failed')) {
      fetchHistory(token);
    }
  }, [orderStatus, token, fetchHistory]);

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const r = await fetch(`${IDENTITY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setLoginError(r.status === 429
          ? `⏱ Too many attempts. Try again in ${data.retry_after_seconds}s.`
          : data.detail || 'Login failed.');
        return;
      }
      setToken(data.access_token);
    } catch {
      setLoginError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Cart ─────────────────────────────────────────────────────────────────────
  const updateCart = (id: string, delta: number) => {
    setCart(prev => {
      const next = { ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) };
      if (next[id] === 0) delete next[id];
      return next;
    });
  };

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

  // ── Place Order ──────────────────────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (!token || totalItems === 0) return;
    setOrdering(true);
    setOrderError('');
    setOrderStatus(null);
    setOrderId(null);

    const idempotencyKey = crypto.randomUUID();
    const items = Object.entries(cart).map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));

    try {
      const r = await fetch(`${GATEWAY_URL}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ items }),
      });
      const data = await r.json();
      if (!r.ok) { setOrderError(data.detail || 'Order failed.'); return; }
      setOrderId(data.order_id);
      setOrderStatus('pending');
      setCart({});
      startSSE(data.order_id);
    } catch {
      setOrderError('Network error. Is the gateway running?');
    } finally {
      setOrdering(false);
    }
  };

  const startSSE = (oid: string) => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${NOTIFICATION_URL}/notifications/stream/${oid}`);
    esRef.current = es;
    es.addEventListener('order_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.status) setOrderStatus(data.status as OrderStatus);
        if (data.status === 'ready' || data.status === 'failed') es.close();
      } catch {}
    });
    es.onerror = () => console.warn('SSE connection lost — browser will retry');
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString();
  };

  // ── Login page ───────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <main className="container" style={{ paddingTop: '4rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, background: 'linear-gradient(135deg, #6C63FF, #FF6584)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            🍱 IUT Cafeteria
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Iftar ordering — fast, reliable, real-time</p>
        </div>
        <div className="card animate-fade-in" style={{ maxWidth: '400px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.25rem' }}>Student Login</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label>Student ID</label>
              <input id="student-id" value={studentId} onChange={e => setStudentId(e.target.value)}
                placeholder="STU-2021-001" required />
            </div>
            <div>
              <label>Password</label>
              <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            {loginError && <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{loginError}</p>}
            <button id="login-btn" className="btn btn-primary" type="submit" disabled={loginLoading}>
              {loginLoading ? <span className="animate-pulse">Logging in…</span> : 'Login →'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>🍱 Iftar Menu</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>👤 {studentId}</span>
          <button className="btn btn-danger" onClick={() => { setToken(null); setCart({}); setOrderHistory([]); }}
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Logout</button>
        </div>
      </div>

      {/* Menu Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {MENU_ITEMS.map(item => (
          <div key={item.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ fontSize: '2.5rem', textAlign: 'center' }}>{item.emoji}</div>
            <div>
              <h3 style={{ fontWeight: 600 }}>{item.name}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>৳{item.price}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: 'auto' }}>
              <button className="btn btn-primary" onClick={() => updateCart(item.id, -1)}
                style={{ padding: '0.4rem 0.75rem', minWidth: '36px' }} disabled={!cart[item.id]}>−</button>
              <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 600 }}>{cart[item.id] || 0}</span>
              <button className="btn btn-primary" id={`add-${item.id}`}
                onClick={() => updateCart(item.id, 1)} style={{ padding: '0.4rem 0.75rem', minWidth: '36px' }}>+</button>
            </div>
          </div>
        ))}
      </div>

      {/* Cart / Order Button */}
      {totalItems > 0 && (
        <div className="card animate-fade-in" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{totalItems} item{totalItems !== 1 ? 's' : ''} in cart</span>
          <button id="place-order-btn" className="btn btn-primary" onClick={handlePlaceOrder} disabled={ordering}>
            {ordering ? <span className="animate-pulse">Processing…</span> : '🛒 Place Order'}
          </button>
        </div>
      )}

      {orderError && (
        <div className="card animate-fade-in" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <p style={{ color: 'var(--danger)' }}>❌ {orderError}</p>
        </div>
      )}

      {/* Live Order Status (current session) */}
      {orderId && orderStatus && (
        <div className="card animate-fade-in" style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>📦 Current Order #{orderId.slice(-8)}</h2>
          <div className="status-steps">
            {STATUS_STEPS.map(step => (
              <div key={step} className={`status-step ${
                orderStatus === step ? 'active' :
                STATUS_STEPS.indexOf(orderStatus as OrderStatus) > STATUS_STEPS.indexOf(step) ? 'done' : ''
              }`}>
                {STATUS_LABELS[step]}
              </div>
            ))}
          </div>
          {orderStatus === 'ready' && (
            <p style={{ marginTop: '1rem', color: 'var(--success)', fontWeight: 600, textAlign: 'center' }}>
              🎉 Your Iftar order is ready! Please collect from the counter.
            </p>
          )}
          {orderStatus === 'failed' && (
            <p style={{ marginTop: '1rem', color: 'var(--danger)', textAlign: 'center' }}>
              Order processing failed. Please try again.
            </p>
          )}
        </div>
      )}

      {/* Order History */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>📋 My Orders</h2>
          <button className="btn btn-primary" onClick={() => token && fetchHistory(token)}
            style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem' }} disabled={historyLoading}>
            {historyLoading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        </div>

        {historyLoading && orderHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>Loading orders…</p>
        ) : orderHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>No orders yet. Place your first order above!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {orderHistory.map(order => {
              const statusColor = STATUS_COLORS[order.status] || '#6b7280';
              return (
                <div key={order.order_id} style={{
                  border: '1px solid var(--border)',
                  borderRadius: '0.75rem',
                  padding: '0.9rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      #{order.order_id.slice(-8)}
                    </span>
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: `${statusColor}22`,
                      color: statusColor,
                      border: `1px solid ${statusColor}44`,
                    }}>
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatTime(order.created_at)}
                  </div>
                  <div style={{ fontSize: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.2rem' }}>
                    {order.items.map((it, idx) => {
                      const m = MENU_MAP[it.menu_item_id];
                      return (
                        <span key={idx} style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '0.5rem',
                          padding: '0.15rem 0.5rem',
                        }}>
                          {m ? `${m.emoji} ${m.name}` : it.menu_item_id} × {it.quantity}
                        </span>
                      );
                    })}
                  </div>
                  {order.special_notes && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Note: {order.special_notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
