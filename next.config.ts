import type { NextConfig } from 'next'
import { API_CSP } from './src/lib/csp'

// Content-Security-Policy für Seiten setzt src/proxy.ts (mit Nonce pro Anfrage). Hier nur Kopfzeilen für alle Antworten
// und eine strenge Richtlinie für /api (JSON, SSE, Dateiweiterleitungen – nichts davon wird als Seite dargestellt).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
]

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ['@node-rs/argon2', 'pg', 'web-push'],
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: API_CSP }] },
    ]
  },
}

export default config
