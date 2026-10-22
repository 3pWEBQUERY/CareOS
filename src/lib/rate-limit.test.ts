import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryLimiter, decide, storageKey } from './rate-limit-core'

test('Rate-Limit: Entscheidung und Wartezeit', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  const reset = new Date('2026-10-22T10:04:30.200Z')
  assert.deepEqual(decide(1, reset, now, 3), { ok: true, retryAfter: 0, count: 1 })
  assert.deepEqual(decide(3, reset, now, 3), { ok: true, retryAfter: 0, count: 3 })
  assert.deepEqual(decide(4, reset, now, 3), { ok: false, retryAfter: 271, count: 4 })
  // Fenster bereits abgelaufen, Zähler aber noch hoch: mindestens 1 s
  assert.equal(decide(9, now, now, 3).retryAfter, 1)
})

test('Rate-Limit: Schlüssel ohne Klartext (E-Mail, IP)', () => {
  const k = storageKey('login:203.0.113.7:anna.muster@lindenhof.ch')
  assert.match(k, /^login:[\w-]{32}$/)
  assert.ok(!k.includes('anna') && !k.includes('203.0'))
  assert.equal(storageKey('login:203.0.113.7:anna.muster@lindenhof.ch'), k)
  assert.notEqual(storageKey('login:203.0.113.7:lea.rohner@lindenhof.ch'), k)
  assert.match(storageKey('ohne-namensraum'), /^rl:/)
  assert.match(storageKey('a b/c:x'), /^abc:/)
})

test('Rate-Limit: Fixed Window im Speicher (Rückfallebene)', () => {
  const m = new MemoryLimiter()
  const t0 = 1_000_000
  for (let i = 1; i <= 5; i++) assert.equal(m.hit('k', 5, 60_000, t0 + i).ok, true)
  const blocked = m.hit('k', 5, 60_000, t0 + 10)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.retryAfter, 60)
  assert.equal(m.hit('anderer', 5, 60_000, t0 + 10).ok, true)
  // Neues Fenster nach Ablauf
  const fresh = m.hit('k', 5, 60_000, t0 + 60_001)
  assert.deepEqual(fresh, { ok: true, retryAfter: 0, count: 1 })
  m.sweep(t0 + 200_000)
  assert.equal(m.size, 0)
})

// Gegen Postgres nur, wenn DATABASE_URL in der Umgebung gesetzt ist (CI mit Postgres-Service).
test('Rate-Limit: Postgres zählt atomar über parallele Anfragen', { skip: !process.env.DATABASE_URL || process.env.SKIP_DB_TESTS === 'true' }, async () => {
  const { rateLimit, resetRateLimit } = await import('./rate-limit')
  const { db } = await import('./db')
  const key = `test-rl:${Date.now()}:${Math.random()}`
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimit(key, 10, 60_000)))
    const counts = results.map((r) => r.count).sort((a, b) => a - b)
    assert.deepEqual(counts, Array.from({ length: 12 }, (_, i) => i + 1))
    assert.equal(results.filter((r) => r.ok).length, 10)
    assert.ok(results.filter((r) => !r.ok).every((r) => r.retryAfter >= 59 && r.retryAfter <= 60))
    await resetRateLimit(key)
    assert.equal((await rateLimit(key, 10, 60_000)).count, 1)
  } finally {
    await resetRateLimit(key)
    await db.$disconnect()
  }
})
