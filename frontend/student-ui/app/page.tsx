'use client';
import { useState, useEffect, useRef } from 'react';
import styles from './page.module.css';

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

const MENU_ITEMS = [
  { id: 'ITEM-BIRIYANI', name: 'Chicken Biriyani', price: 450, emoji: '🍗' },
  { id: 'ITEM-KEBAB', name: 'Beef Kebab', price: 350, emoji: '🥩' },
  { id: 'ITEM-HALEEM', name: 'Chicken Haleem', price: 300, emoji: '🍲' },
  { id: 'ITEM-JUICE', name: 'Fruit Juice', price: 80, emoji: '🧃' },
  { id: 'ITEM-DATE', name: 'Medjool Dates', price: 150, emoji: '🫐' },
  { id: 'ITEM-SAMOSA', name: 'Samosa', price: 50, emoji: '🥟' },
];

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

  const esRef = useRef<EventSource | null>(null);

  // ── Login ─────────────────────────────────────────────────────────────────
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
        if (r.status === 429) {
          setLoginError(`⏱ Too many attempts. Try again in ${data.retry_after_seconds}s.`);
        } else {
          setLoginError(data.detail || 'Login failed.');
        }
        return;
      }
      setToken(data.access_token);
    } catch (err) {
      setLoginError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Cart ──────────────────────────────────────────────────────────────────
  const updateCart = (id: string, delta: number) => {
    setCart(prev => {
      const next = { ...prev, [id]: Math.max(0, (prev[id] || 0) + delta) };
      if (next[id] === 0) delete next[id];
      return next;
    });
  };

  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);

  // ── Place Order ───────────────────────────────────────────────────────────
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
      if (!r.ok) {
        setOrderError(data.detail || 'Order failed.');
        return;
      }
      setOrderId(data.order_id);
      setOrderStatus('pending');
      setCart({});
      // Start SSE stream
      startSSE(data.order_id);
    } catch (err) {
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

  // ── Render ────────────────────────────────────────────────────────────────
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>🍱 Iftar Menu</h1>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>👤 {studentId}</span>
          <button className="btn btn-danger" onClick={() => { setToken(null); setCart({}); }} style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Logout</button>
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

      {/* Order Button */}
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

      {/* Order Status */}
      {orderId && orderStatus && (
        <div className="card animate-fade-in">
          <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>📦 Order #{orderId.slice(-8)}</h2>
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
    </main>
  );
}
