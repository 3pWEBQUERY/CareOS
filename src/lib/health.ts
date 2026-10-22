import { db } from '@/lib/db'
import { pushConfigured, storageConfigured } from '@/lib/env'
import { headBucket } from '@/lib/storage'
import { startedAt } from '@/lib/metrics'

/**
 * Betriebszustand (PRD §38): Datenbank, Bucket, Hintergrundjobs, Echtzeit, Push.
 * Genutzt von /api/health (Railway Health Check), /api/metrics und Admin → Sicherheit → Betrieb.
 * HTTP 503 nur, wenn die Datenbank nicht erreichbar ist; sonst «degraded» mit 200 (Deploys nicht blockieren).
 */
export type State = 'ok' | 'degraded' | 'error' | 'off'
export { JOB_EXPECT_MS, jobState, type JobState, type JobHealth } from '@/lib/health-core'
import { JOB_EXPECT_MS, jobState, type JobHealth } from '@/lib/health-core'

let bucketCache: { at: number; state: State; ms: number | null; error?: string } | null = null

async function bucketHealth(): Promise<{ state: State; ms: number | null; error?: string }> {
  if (!storageConfigured()) return { state: 'off', ms: null }
  if (bucketCache && Date.now() - bucketCache.at < 60_000) return bucketCache
  try {
    const ms = await headBucket(2500)
    bucketCache = { at: Date.now(), state: 'ok', ms }
  } catch (e) {
    const name = (e as { name?: string }).name ?? 'Error'
    bucketCache = { at: Date.now(), state: 'error', ms: null, error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : name }
  }
  return bucketCache
}

function realtimeHealth(): { state: State; connections: number } {
  const g = globalThis as unknown as { __careosRealtime?: { listeners: Set<unknown>; client: unknown } }
  const rt = g.__careosRealtime
  if (!rt) return { state: 'ok', connections: 0 } // noch keine Verbindung auf dieser Instanz
  return { state: rt.client || rt.listeners.size === 0 ? 'ok' : 'degraded', connections: rt.listeners.size }
}

export async function jobsHealth(now = new Date()): Promise<JobHealth[]> {
  const uptime = Date.now() - startedAt()
  const disabledHere = process.env.JOBS_DISABLED === 'true'
  return Promise.all(
    Object.entries(JOB_EXPECT_MS).map(async ([name, expect]) => {
      const last = await db.jobRun.findFirst({ where: { name }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, finishedAt: true, ok: true, error: true } })
      return {
        name,
        state: jobState(last, expect, now, uptime, disabledHere),
        lastStartedAt: last?.startedAt ?? null,
        lastOk: last?.ok ?? null,
        durationMs: last?.finishedAt ? last.finishedAt.getTime() - last.startedAt.getTime() : null,
        error: last?.ok === false ? (last.error ?? '').slice(0, 200) : null,
      }
    }),
  )
}

export async function healthReport(now = new Date()) {
  const t0 = Date.now()
  let dbState: State = 'ok'
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbState = 'error'
  }
  const dbMs = Date.now() - t0
  if (dbState === 'error') {
    return { status: 'error' as State, db: { state: dbState, ms: null }, storage: null, jobs: [], realtime: null, push: null, uptimeS: Math.round((Date.now() - startedAt()) / 1000) }
  }
  const [storage, jobs] = await Promise.all([bucketHealth(), jobsHealth(now)])
  const realtime = realtimeHealth()
  const push: State = pushConfigured() ? 'ok' : 'off'
  const degraded = storage.state === 'error' || realtime.state !== 'ok' || jobs.some((j) => j.state === 'stale' || j.state === 'failing')
  return {
    status: (degraded ? 'degraded' : 'ok') as State,
    db: { state: dbState, ms: dbMs },
    storage,
    jobs,
    realtime,
    push,
    uptimeS: Math.round((Date.now() - startedAt()) / 1000),
  }
}
