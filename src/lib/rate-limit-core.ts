/**
 * Rate-Limit – reine Logik ohne Server-Abhängigkeiten (testbar).
 * Fixed Window: pro Schlüssel ein Zähler und ein Fensterende.
 */
import { createHash } from 'node:crypto'

export type RateResult = { ok: boolean; retryAfter: number; count: number }

/** Entscheidung aus Zählerstand und Fensterende (Sekunden bis zum Fensterende, mindestens 1). */
export function decide(count: number, resetAt: Date, now: Date, limit: number): RateResult {
  if (count <= limit) return { ok: true, retryAfter: 0, count }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)), count }
}

/**
 * Speicherschlüssel: Namensraum (Teil vor dem ersten «:») im Klartext, Rest als SHA-256.
 * So stehen keine E-Mail-Adressen oder IP-Adressen in der Tabelle (Datenminimierung, PRD §36).
 */
export function storageKey(key: string) {
  const i = key.indexOf(':')
  const ns = (i > 0 ? key.slice(0, i) : 'rl').replace(/[^\w-]/g, '').slice(0, 32) || 'rl'
  return `${ns}:${createHash('sha256').update(key).digest('base64url').slice(0, 32)}`
}

/** Fixed Window im Prozessspeicher: Rückfallebene, wenn die Datenbank nicht erreichbar ist (und für Tests). */
export class MemoryLimiter {
  private buckets = new Map<string, { n: number; reset: number }>()

  hit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
    const b = this.buckets.get(key)
    if (!b || b.reset <= now) {
      this.buckets.set(key, { n: 1, reset: now + windowMs })
      if (this.buckets.size > 10_000) this.sweep(now)
      return decide(1, new Date(now + windowMs), new Date(now), limit)
    }
    b.n++
    return decide(b.n, new Date(b.reset), new Date(now), limit)
  }

  sweep(now = Date.now()) {
    for (const [k, b] of this.buckets) if (b.reset <= now) this.buckets.delete(k)
  }

  get size() {
    return this.buckets.size
  }
}
