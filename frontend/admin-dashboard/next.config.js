/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // basePath tells Next.js it is served under /admin/ so all /_next/static/
  // asset URLs are emitted as /admin/_next/static/... — nginx's /admin/ block
  // then catches them, rewrites the prefix away, and proxies to this service.
  basePath: '/admin',
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:8002',
    NEXT_PUBLIC_PROMETHEUS_URL: process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090',
    NEXT_PUBLIC_GRAFANA_URL: process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3002',
    NEXT_PUBLIC_NOTIFICATION_URL: process.env.NEXT_PUBLIC_NOTIFICATION_URL || 'http://localhost:8005',
  },
};
module.exports = nextConfig;
