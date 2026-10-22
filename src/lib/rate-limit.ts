import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { MemoryLimiter, decide, storageKey, type RateResult } from '@/lib/rate-limit-core'

/**
 * Rate-Limit über alle Instanzen (PRD §37): Fixed Window in Postgres (Tabelle RateLimit).
 * Ein einziges atomares Upsert pro Aufruf; Zeit kommt aus der Datenbank (gleiche Uhr für alle Instanzen).
 * Ist die Datenbank nicht erreichbar, zählt der Prozessspeicher weiter (lieber pro Instanz begrenzen als gar nicht).
 * Abgelaufene Zeilen entfernt der Job «security» (src/lib/jobs.ts).
 *
 * Aufruf: `if (!(await rateLimit('login:' + ip, 8, 10 * 60_000)).ok) …`
 */
const fallback = new MemoryLimiter()

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const k = storageKey(key)
  try {
    const rows = await db.$queryRaw<{ count: number; resetAt: Date; now: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${k}, 1, now() + make_interval(secs => ${windowMs / 1000}))
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt", now() AS "now"`
    const r = rows[0]
    if (!r) throw new Error('rate_limit_no_row')
    return decide(Number(r.count), new Date(r.resetAt), new Date(r.now), limit)
  } catch (e) {
    log.warn('rate_limit.fallback', { error: e instanceof Error ? e.message : String(e) })
    return fallback.hit(k, limit, windowMs)
  }
}

/** Zähler zurücksetzen (z. B. nach erfolgreicher Anmeldung). */
export async function resetRateLimit(key: string) {
  await db.rateLimit.delete({ where: { key: storageKey(key) } }).catch(() => {})
}

/** Entfernt abgelaufene Fenster (Job «security»). */
export async function sweepRateLimits(now = new Date()) {
  fallback.sweep(now.getTime())
  const r = await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 60_000) } } })
  return r.count
}
