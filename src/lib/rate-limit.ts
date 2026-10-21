/**
 * Einfaches Fixed-Window-Rate-Limit im Prozessspeicher.
 * Reicht für eine Instanz; bei horizontaler Skalierung auf Postgres oder Redis umstellen.
 */
const buckets = new Map<string, { n: number; reset: number }>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  b.n++
  if (b.n > limit) return { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) }
  return { ok: true, retryAfter: 0 }
}

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k)
}, 60_000).unref?.()
