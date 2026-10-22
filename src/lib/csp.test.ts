import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketOrigins, buildCsp, cspHeaderName, makeNonce } from './csp'

const dir = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(name + ' '))?.slice(name.length + 1) ?? null

test('CSP: Produktion mit Nonce, ohne unsafe-eval und ohne unsafe-inline für Skripte', () => {
  const csp = buildCsp('abc123', { NODE_ENV: 'production', APP_URL: 'https://care.example.ch', ENDPOINT: 'https://storage.railway.app', BUCKET: 'careos-x' })
  assert.equal(dir(csp, 'script-src'), "'self' 'nonce-abc123' 'strict-dynamic'")
  assert.ok(!csp.includes('unsafe-eval'))
  assert.equal(dir(csp, 'style-src-elem'), "'self' 'nonce-abc123'")
  assert.equal(dir(csp, 'style-src-attr'), "'unsafe-inline'")
  assert.equal(dir(csp, 'img-src'), "'self' data: blob: https://storage.railway.app")
  assert.equal(dir(csp, 'connect-src'), "'self' https://storage.railway.app")
  assert.equal(dir(csp, 'object-src'), "'none'")
  assert.equal(dir(csp, 'frame-ancestors'), "'none'")
  assert.equal(dir(csp, 'worker-src'), "'self'")
  assert.ok(dir(csp, 'frame-src')!.includes('https://www.youtube-nocookie.com'))
  assert.ok(csp.endsWith('upgrade-insecure-requests'))
})

test('CSP: Entwicklung bleibt bedienbar (eval für React, Inline-Styles für Hot Reload, WebSocket)', () => {
  const csp = buildCsp('n', { NODE_ENV: 'development', APP_URL: 'http://localhost:3000' })
  assert.ok(dir(csp, 'script-src')!.includes("'unsafe-eval'"))
  assert.equal(dir(csp, 'style-src'), "'self' 'unsafe-inline'")
  assert.ok(dir(csp, 'connect-src')!.includes('ws:'))
  assert.ok(!csp.includes('upgrade-insecure-requests'))
})

test('CSP: Bucket-Herkünfte und Zusatzquellen', () => {
  assert.deepEqual(bucketOrigins({}), [])
  assert.deepEqual(bucketOrigins({ AWS_ENDPOINT_URL: 'https://s3.eu.example.com/', AWS_S3_BUCKET_NAME: 'b1', S3_FORCE_PATH_STYLE: 'false' }), ['https://s3.eu.example.com', 'https://b1.s3.eu.example.com'])
  assert.deepEqual(bucketOrigins({ ENDPOINT: 'kein url' }), [])
  const csp = buildCsp('n', { NODE_ENV: 'production', CSP_IMG_SRC: "https://cdn.example.ch javascript:alert(1) 'unsafe-inline'" })
  assert.equal(dir(csp, 'img-src'), "'self' data: blob: https://cdn.example.ch")
  assert.ok(!csp.includes('upgrade-insecure-requests')) // ohne https-APP_URL (lokaler Produktionstest)
  assert.equal(cspHeaderName({ CSP_REPORT_ONLY: 'true' }), 'Content-Security-Policy-Report-Only')
  assert.equal(cspHeaderName({}), 'Content-Security-Policy')
})

test('CSP: Nonce ist zufällig und Base64', () => {
  const a = makeNonce()
  const b = makeNonce()
  assert.notEqual(a, b)
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/)
})
