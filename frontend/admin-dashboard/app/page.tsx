'use client';
import { useState, useEffect, useCallback } from 'react';

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || 'http://localhost:8001';
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8002';
const PROMETHEUS_URL = process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090';
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3002';
const NOTIFICATION_URL = process.env.NEXT_PUBLIC_NOTIFICATION_URL || 'http://localhost:8005';

const SERVICES = [
  { id: 'identity-provider', name: 'Identity Provider', url: 'http://localhost:8001/health', port: 8001 },
  { id: 'order-gateway',     name: 'Order Gateway',     url: 'http://localhost:8002/health', port: 8002 },
  { id: 'stock-service',     name: 'Stock Service',     url: 'http://localhost:8003/health', port: 8003 },
  { id: 'kitchen-queue',     name: 'Kitchen Queue',     url: 'http://localhost:8004/health', port: 8004 },
  { id: 'notification-hub',  name: 'Notification Hub',  url: 'http://localhost:8005/health', port: 8005 },
];

type ServiceStatus = { status: 'healthy' | 'degraded' | 'unknown' | 'checking'; dependencies?: Record<string, string> };

/** Decode JWT payload without verifying signature (public fields only). */
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return null; }
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [adminId, setAdminId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [serviceStatuses, setServiceStatuses] = useState<Record<string, ServiceStatus>>({});
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);
  const [latencyAlert, setLatencyAlert] = useState(false);
  const [chaosActive, setChaosActive] = useState(false);
  const [chaosLoading, setChaosLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const r = await fetch(`${IDENTITY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: loginId, password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setLoginError(r.status === 429
          ? `⏱ Too many attempts. Retry in ${data.retry_after_seconds}s.`
          : data.detail || 'Login failed.');
        return;
      }
      const claims = parseJwt(data.access_token);
      if (!claims?.is_admin) {
        setLoginError('Access denied: administrator account required.');
        return;
      }
      setToken(data.access_token);
      setAdminId(loginId);
    } catch {
      setLoginError('Network error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Service health polling ───────────────────────────────────────────────────
  const checkAllServices = useCallback(async () => {
    setLastRefresh(new Date().toLocaleTimeString());
    for (const svc of SERVICES) {
      setServiceStatuses(prev => ({ ...prev, [svc.id]: { status: 'checking' } }));
      try {
        const start = performance.now();
        const r = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
        const elapsed = performance.now() - start;
        const data = await r.json();
        if (svc.id === 'order-gateway') {
          setGatewayLatency(Math.round(elapsed));
          setLatencyAlert(elapsed > 1000);
        }
        setServiceStatuses(prev => ({
          ...prev,
          [svc.id]: { status: r.ok ? data.status : 'degraded', dependencies: data.dependencies },
        }));
      } catch {
        setServiceStatuses(prev => ({ ...prev, [svc.id]: { status: 'degraded' } }));
      }
    }
  }, []);

  const checkChaos = useCallback(async () => {
    try {
      const r = await fetch(`${NOTIFICATION_URL}/notifications/chaos`);
      const data = await r.json();
      setChaosActive(data.chaos_enabled);
    } catch {}
  }, []);

  const toggleChaos = async () => {
    setChaosLoading(true);
    try {
      const endpoint = chaosActive ? 'disable' : 'enable';
      await fetch(`${NOTIFICATION_URL}/notifications/chaos/${endpoint}`, { method: 'POST' });
      await checkChaos();
      await checkAllServices();
    } catch {}
    setChaosLoading(false);
  };

  useEffect(() => {
    if (!token) return;
    checkAllServices();
    checkChaos();
    const interval = setInterval(() => { checkAllServices(); checkChaos(); }, 15000);
    return () => clearInterval(interval);
  }, [token, checkAllServices, checkChaos]);

  const getStatusColor = (status: string) => {
    if (status === 'healthy') return 'var(--success)';
    if (status === 'checking') return 'var(--warning)';
    return 'var(--danger)';
  };

  const healthyCount = Object.values(serviceStatuses).filter(s => s.status === 'healthy').length;

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!token) {
    return (
      <main className="container" style={{ paddingTop: '4rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 style={{
            fontSize: '2rem', fontWeight: 700,
            background: 'linear-gradient(135deg, #6C63FF, #FF6584)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            ⚙️ TrioTect Admin Console
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            IUT Cafeteria — Distributed System Monitor
          </p>
        </div>

        <div className="card animate-fade-in" style={{ maxWidth: '420px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.15rem', fontWeight: 600 }}>
            🔐 Administrator Login
          </h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Admin ID
              </label>
              <input
                id="admin-id"
                value={loginId}
                onChange={e => setLoginId(e.target.value)}
                placeholder="ADMIN-001"
                required
                style={{
                  width: '100%', padding: '0.625rem 0.875rem',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)',
                  borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%', padding: '0.625rem 0.875rem',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--card-border)',
                  borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none',
                }}
              />
            </div>
            {loginError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.875rem', padding: '0.5rem 0.75rem',
                background: 'rgba(239,68,68,0.08)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
                ❌ {loginError}
              </p>
            )}
            <button
              id="login-btn"
              className="btn btn-primary"
              type="submit"
              disabled={loginLoading}
              style={{ marginTop: '0.25rem', justifyContent: 'center', fontSize: '0.95rem' }}
            >
              {loginLoading ? <span className="animate-pulse">Authenticating…</span> : 'Login to Console →'}
            </button>
          </form>
          <p style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Admin accounts only. Student accounts will be rejected.
          </p>
        </div>
      </main>
    );
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, background: 'linear-gradient(135deg, #6C63FF, #FF6584)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TrioTect Admin Console
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            IUT Cafeteria — Distributed System Monitor &nbsp;·&nbsp; 👤 {adminId}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last refresh: {lastRefresh}</span>
          <button id="refresh-btn" className="btn btn-primary"
            onClick={() => { checkAllServices(); checkChaos(); }}
            style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
            ↻ Refresh
          </button>
          <button className="btn btn-danger"
            onClick={() => { setToken(null); setAdminId(''); }}
            style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Latency Alert Banner */}
      {latencyAlert && (
        <div className="card animate-fade-in" style={{ borderColor: 'var(--danger)', background: 'rgba(239,68,68,0.1)', marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '1.5rem' }}>🚨</span>
          <div>
            <p style={{ color: 'var(--danger)', fontWeight: 700 }}>ALERT: Order Gateway Latency Critical!</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Average response time is {gatewayLatency}ms — exceeds 1000ms threshold. System may be under saturation.
            </p>
          </div>
        </div>
      )}

      {/* Summary Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="metric-value" style={{ color: healthyCount === SERVICES.length ? 'var(--success)' : 'var(--danger)' }}>
            {healthyCount}/{SERVICES.length}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Healthy Services</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="metric-value" style={{ color: latencyAlert ? 'var(--danger)' : 'var(--success)' }}>
            {gatewayLatency !== null ? `${gatewayLatency}ms` : '—'}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Gateway Latency</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="metric-value" style={{ color: chaosActive ? 'var(--danger)' : 'var(--text-muted)' }}>
            {chaosActive ? 'ON' : 'OFF'}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Chaos Mode</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="metric-value" style={{ color: 'var(--primary)', fontSize: '1rem', paddingTop: '0.5rem' }}>
            <a href={GRAFANA_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
              📊 Grafana →
            </a>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Metrics Dashboard</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Health Grid */}
        <div className="card">
          <h2 style={{ marginBottom: '1.25rem', fontSize: '1rem', fontWeight: 600 }}>🟢 Service Health Grid</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {SERVICES.map(svc => {
              const s = serviceStatuses[svc.id];
              const statusVal = s?.status || 'unknown';
              const color = getStatusColor(statusVal);
              return (
                <div key={svc.id} id={`health-${svc.id}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.875rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                    border: `1px solid ${statusVal === 'degraded' ? 'rgba(239,68,68,0.3)' : 'var(--card-border)'}`,
                    transition: 'all 0.3s' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <span className="dot" style={{ background: color }} />
                    <div>
                      <p style={{ fontWeight: 500, fontSize: '0.9rem' }}>{svc.name}</p>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>:{svc.port}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {statusVal === 'checking' ? '…' : statusVal}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chaos Engineering Panel */}
        <div className="card">
          <h2 style={{ marginBottom: '0.5rem', fontSize: '1rem', fontWeight: 600 }}>⚡ Chaos Engineering</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Inject synthetic failures into the Notification Hub to verify service isolation.
            The Order Gateway and Stock Service must remain operational.
          </p>
          <div style={{ padding: '1.25rem', borderRadius: '10px', background: 'rgba(255,255,255,0.03)',
            border: `2px solid ${chaosActive ? 'var(--danger)' : 'var(--card-border)'}`, marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Notification Hub Target</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  {chaosActive ? '💥 Injecting 503 errors and severing SSE connections' : 'Nominal — no chaos active'}
                </p>
              </div>
              <div style={{ width: '60px', height: '32px', borderRadius: '999px',
                background: chaosActive ? 'var(--danger)' : '#333', cursor: chaosLoading ? 'not-allowed' : 'pointer',
                position: 'relative', transition: 'background 0.3s', opacity: chaosLoading ? 0.6 : 1 }}
                id="chaos-toggle"
                onClick={!chaosLoading ? toggleChaos : undefined}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'white',
                  position: 'absolute', top: '4px', transition: 'left 0.3s',
                  left: chaosActive ? '32px' : '4px' }} />
              </div>
            </div>
          </div>
          {chaosActive && (
            <div className="animate-fade-in" style={{ padding: '1rem', borderRadius: '8px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '0.875rem' }}>⚠️ CHAOS MODE ACTIVE</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Notification Hub is returning 503. Verify that orders still process via Gateway + Stock + Kitchen.
              </p>
            </div>
          )}

          {/* Prometheus Quick Links */}
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
              Quick Prometheus Queries
            </h3>
            {[
              { label: 'Gateway avg latency (30s)', query: 'sum(rate(http_request_duration_seconds_sum{job="order-gateway"}[30s]))/sum(rate(http_request_duration_seconds_count{job="order-gateway"}[30s]))' },
              { label: 'Total orders (1m)', query: 'sum(increase(http_requests_total{job="order-gateway", status="202"}[1m]))' },
              { label: 'Error rate (5m)', query: 'sum(rate(http_requests_total{status=~"5.."}[5m]))' },
            ].map(({ label, query }) => (
              <a key={label} href={`${PROMETHEUS_URL}/graph?g0.expr=${encodeURIComponent(query)}&g0.tab=0`}
                target="_blank" rel="noreferrer"
                style={{ display: 'block', padding: '0.5rem 0.75rem', marginBottom: '0.5rem',
                  background: 'rgba(108,99,255,0.08)', borderRadius: '6px', fontSize: '0.8rem',
                  color: 'var(--primary)', textDecoration: 'none', border: '1px solid rgba(108,99,255,0.2)' }}>
                📈 {label} →
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Grafana embed */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>📊 Grafana Live Metrics</h2>
          <a href={GRAFANA_URL} target="_blank" rel="noreferrer"
            className="btn btn-primary"
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem', textDecoration: 'none' }}>
            Open Grafana ↗
          </a>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', overflow: 'hidden' }}>
          <iframe
            src={`${GRAFANA_URL}/?kiosk&orgId=1&refresh=10s`}
            width="100%" height="420" frameBorder="0"
            style={{ display: 'block' }}
            title="Grafana Dashboard"
          />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
          Live Grafana metrics — must be logged in to Grafana for the embed to display.{' '}
          <a href={GRAFANA_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
            Login / open full dashboard →
          </a>
        </p>
      </div>
    </main>
  );
}
