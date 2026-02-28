'use client';
import { useState, useEffect, useCallback } from 'react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8002';
const PROMETHEUS_URL = process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090';
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3002';
const NOTIFICATION_URL = process.env.NEXT_PUBLIC_NOTIFICATION_URL || 'http://localhost:8005';

const SERVICES = [
  { id: 'identity-provider', name: 'Identity Provider', url: 'http://localhost:8001/health', port: 8001 },
  { id: 'order-gateway', name: 'Order Gateway', url: 'http://localhost:8002/health', port: 8002 },
  { id: 'stock-service', name: 'Stock Service', url: 'http://localhost:8003/health', port: 8003 },
  { id: 'kitchen-queue', name: 'Kitchen Queue', url: 'http://localhost:8004/health', port: 8004 },
  { id: 'notification-hub', name: 'Notification Hub', url: 'http://localhost:8005/health', port: 8005 },
];

type ServiceStatus = { status: 'healthy' | 'degraded' | 'unknown' | 'checking'; dependencies?: Record<string, string> };

export default function AdminPage() {
  const [serviceStatuses, setServiceStatuses] = useState<Record<string, ServiceStatus>>({});
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);
  const [latencyAlert, setLatencyAlert] = useState(false);
  const [chaosActive, setChaosActive] = useState(false);
  const [chaosLoading, setChaosLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');

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

  // Check chaos status
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

  // Auto-refresh every 15s
  useEffect(() => {
    checkAllServices();
    checkChaos();
    const interval = setInterval(() => { checkAllServices(); checkChaos(); }, 15000);
    return () => clearInterval(interval);
  }, [checkAllServices, checkChaos]);

  const getStatusColor = (status: string) => {
    if (status === 'healthy') return 'var(--success)';
    if (status === 'checking') return 'var(--warning)';
    return 'var(--danger)';
  };

  const healthyCount = Object.values(serviceStatuses).filter(s => s.status === 'healthy').length;

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, background: 'linear-gradient(135deg, #6C63FF, #FF6584)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TrioTect Admin Console
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            IUT Cafeteria — Distributed System Monitor
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last refresh: {lastRefresh}</span>
          <button id="refresh-btn" className="btn btn-primary" onClick={() => { checkAllServices(); checkChaos(); }} style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>
            ↻ Refresh
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
              Average response time is {gatewayLatency}ms — exceeds 1000ms threshold (PromQL rule triggered).
              System may be under saturation.
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
                background: chaosActive ? 'var(--danger)' : '#333', cursor: 'pointer',
                position: 'relative', transition: 'background 0.3s' }}
                id="chaos-toggle"
                onClick={toggleChaos}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'white',
                  position: 'absolute', top: '4px', transition: 'left 0.3s',
                  left: chaosActive ? '32px' : '4px' }} />
              </div>
            </div>
          </div>
          {chaosActive && (
            <div className="animate-fade-in" style={{ padding: '1rem', borderRadius: '8px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '0.875rem' }}>
                ⚠️ CHAOS MODE ACTIVE
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Notification Hub is returning 503. Verify that orders still process via Gateway + Stock + Kitchen.
              </p>
            </div>
          )}

          {/* Prometheus Quick Links */}
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-muted)' }}>Quick Prometheus Queries</h3>
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

      {/* Grafana embed placeholder */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>📊 Grafana Live Metrics</h2>
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', overflow: 'hidden' }}>
          <iframe
            src={`${GRAFANA_URL}/d/triotect-overview?orgId=1&refresh=10s&kiosk=tv`}
            width="100%" height="400" frameBorder="0"
            style={{ display: 'block' }}
          />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
          Embedded Grafana dashboard. <a href={GRAFANA_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Open full dashboard →</a>
        </p>
      </div>
    </main>
  );
}
