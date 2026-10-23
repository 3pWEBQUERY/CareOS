import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { lastDailySlot, retentionPolicy } from '@/lib/retention-policy'

/**
 * Hintergrundjobs. Gestartet aus src/instrumentation.ts (nur Node.js-Laufzeit, abschaltbar mit JOBS_DISABLED=true).
 *
 * Mehrere Instanzen (Railway, horizontal skaliert): jeder Lauf nimmt eine Postgres-Advisory-Lock
 * (pg_try_advisory_xact_lock(hashtext(name))). Die Lock gilt für die Transaktion, die den Lauf umschliesst,
 * und wird beim Ende (auch bei Abbruch der Verbindung) automatisch freigegeben. So läuft ein Job nie
 * parallel; zusätzlich verhindert ein Mindestabstand, dass jede Instanz denselben Lauf wiederholt.
 *
 * Jobs:
 * - escalations: alle 5 Minuten (Eskalationsregeln, src/lib/escalations.ts)
 * - retention:   täglich 02:30 Europe/Zurich, geprüft alle 10 Minuten (Löschkonzept, src/lib/retention.ts)
 * - cleanup:     stündlich (abgelaufene Sitzungen und Anmelde-Challenges)
 * - security:    alle 5 Minuten (Audit-Überwachung src/lib/security-alerts.ts, abgelaufene Rate-Limits, alte Fehlerzähler)
 * - reminders:   täglich 06:30 Europe/Zurich je Organisation, geprüft alle 10 Minuten (Ablauf von Zertifikaten,
 *                Qualifikationen, Schulungsfristen, Dokument-Gültigkeit; src/lib/reminders.ts)
 * - tasks:       alle 5 Minuten (Aufgaben aller Bereiche erzeugen, damit Seitenaufrufe nicht warten; Rückstand
 *                zeitgebundener Routineaufgaben nach der Folgeschicht schliessen; src/lib/tasks.ts runTaskJob)
 */

export type JobName = 'escalations' | 'retention' | 'cleanup' | 'security' | 'reminders' | 'tasks'

const MIN = 60_000
const LOCK_TIMEOUT = 60 * MIN

/** Führt fn exklusiv über alle Instanzen aus. locked=false: ein anderer Lauf ist aktiv. */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<{ locked: true; value: T } | { locked: false }> {
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${'careos:job:' + name})) AS ok`
      if (!rows[0]?.ok) return { locked: false as const }
      return { locked: true as const, value: await fn() }
    },
    { timeout: LOCK_TIMEOUT, maxWait: 10_000 },
  )
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue

/** Protokolliert einen Lauf in JobRun (Start, Ende, Ergebnis oder Fehler). */
export async function recordRun<T>(name: string, meta: { orgId?: string | null; trigger?: string; actorId?: string | null }, fn: () => Promise<T>) {
  const run = await db.jobRun.create({ data: { name, orgId: meta.orgId ?? null, trigger: meta.trigger ?? 'schedule', actorId: meta.actorId ?? null } })
  try {
    const value = await fn()
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, summary: json(value) } })
    return { ok: true as const, value, runId: run.id }
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 2000)
    console.error(`[jobs] ${name} failed`, e)
    void import('@/lib/errors').then((m) => m.captureError(e, { route: 'job:' + name, routeType: 'job' })).catch(() => {})
    await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error } }).catch(() => {})
    return { ok: false as const, error, runId: run.id }
  }
}

/** Wurde der Job (ohne Organisationsbezug) seit diesem Zeitpunkt bereits gestartet? */
const ranSince = async (name: string, since: Date, orgId: string | null = null) =>
  (await db.jobRun.count({ where: { name, orgId, startedAt: { gte: since } } })) > 0

// ───────────── Jobs ─────────────

async function escalationsJob(now: Date) {
  if (await ranSince('escalations', new Date(now.getTime() - 4 * MIN))) return
  const last = await db.jobRun.findFirst({ where: { name: 'escalations', ok: true }, orderBy: { startedAt: 'desc' }, select: { summary: true } })
  const prev = last?.summary && typeof last.summary === 'object' && !Array.isArray(last.summary) ? (last.summary as Record<string, unknown>).cursor : null
  const { runEscalations } = await import('@/lib/escalations')
  await recordRun('escalations', {}, () => runEscalations(now, typeof prev === 'string' ? new Date(prev) : null))
}

async function retentionJob(now: Date) {
  const slot = lastDailySlot(now, '02:30', 'Europe/Zurich')
  const { runRetention, runSystemRetention } = await import('@/lib/retention')
  const orgs = await db.organization.findMany({ select: { id: true, settings: true } })
  for (const org of orgs) {
    if (!retentionPolicy(org.settings).auto) continue
    // Ein geplanter Lauf pro Organisation und Tag; ein manueller Lauf ersetzt ihn nicht.
    if ((await db.jobRun.count({ where: { name: 'retention', orgId: org.id, trigger: 'schedule', startedAt: { gte: slot } } })) > 0) continue
    await recordRun('retention', { orgId: org.id }, () => runRetention(org.id, { now, trigger: 'schedule' }))
  }
  if (!(await ranSince('retention', slot))) await recordRun('retention', {}, () => runSystemRetention(now))
}

async function cleanupJob(now: Date) {
  if (await ranSince('cleanup', new Date(now.getTime() - 55 * MIN))) return
  const { runCleanup } = await import('@/lib/retention')
  await recordRun('cleanup', {}, () => runCleanup(now))
}

async function securityJob(now: Date) {
  if (await ranSince('security', new Date(now.getTime() - 4 * MIN))) return
  await recordRun('security', {}, async () => {
    const { runSecurityMonitor } = await import('@/lib/security-alerts')
    const { sweepRateLimits } = await import('@/lib/rate-limit')
    const monitor = await runSecurityMonitor(now)
    const rateLimits = await sweepRateLimits(now)
    // Fehlerzähler (ErrorEvent) 90 Tage aufbewahren
    const errors = (await db.errorEvent.deleteMany({ where: { lastAt: { lt: new Date(now.getTime() - 90 * 24 * 60 * MIN) } } })).count
    return { ...monitor, rateLimitsRemoved: rateLimits, errorEventsRemoved: errors }
  })
}

async function remindersJob(now: Date) {
  const slot = lastDailySlot(now, '06:30', 'Europe/Zurich')
  const { runReminders } = await import('@/lib/reminders')
  const orgs = await db.organization.findMany({ select: { id: true } })
  for (const org of orgs) {
    // Ein Lauf pro Organisation und Tag; Erinnerungen sind zusätzlich je Stufe idempotent (Audit-Merker).
    if ((await db.jobRun.count({ where: { name: 'reminders', orgId: org.id, startedAt: { gte: slot } } })) > 0) continue
    await recordRun('reminders', { orgId: org.id }, () => runReminders(org.id, now))
  }
}

async function tasksJob(now: Date) {
  if (await ranSince('tasks', new Date(now.getTime() - 4 * MIN))) return
  const { runTaskJob } = await import('@/lib/tasks')
  await recordRun('tasks', {}, () => runTaskJob(now))
}

export const JOBS: Record<JobName, { everyMs: number; run: (now: Date) => Promise<void> }> = {
  escalations: { everyMs: 5 * MIN, run: escalationsJob },
  retention: { everyMs: 10 * MIN, run: retentionJob },
  cleanup: { everyMs: 60 * MIN, run: cleanupJob },
  security: { everyMs: 5 * MIN, run: securityJob },
  reminders: { everyMs: 10 * MIN, run: remindersJob },
  tasks: { everyMs: 5 * MIN, run: tasksJob },
}

// ───────────── Scheduler ─────────────

type State = { timers: NodeJS.Timeout[]; running: Set<string> }
const g = globalThis as unknown as { __careosJobs?: State }

/** Einen Job sofort ausführen (mit Lock). Gibt false zurück, wenn er bereits läuft. */
export async function tick(name: JobName, now = new Date()) {
  const state = (g.__careosJobs ??= { timers: [], running: new Set() })
  if (state.running.has(name)) return false
  state.running.add(name)
  try {
    const r = await withJobLock(name, () => JOBS[name].run(now))
    return r.locked
  } catch (e) {
    console.error(`[jobs] ${name}`, e)
    return false
  } finally {
    state.running.delete(name)
  }
}

export function startJobs() {
  if (g.__careosJobs?.timers.length) return // bereits gestartet (z. B. nach Hot Reload)
  const state = (g.__careosJobs ??= { timers: [], running: new Set() })
  const names = Object.keys(JOBS) as JobName[]
  names.forEach((name, i) => {
    // Erster Lauf leicht versetzt nach dem Start, damit der Server zuerst Anfragen bedienen kann.
    const first = setTimeout(() => void tick(name), 30_000 + i * 10_000)
    first.unref()
    const every = setInterval(() => void tick(name), JOBS[name].everyMs)
    every.unref()
    state.timers.push(first, every)
  })
  console.log('[jobs] gestartet:', names.join(', '))
}

export function stopJobs() {
  const state = g.__careosJobs
  if (!state) return
  for (const t of state.timers) clearTimeout(t)
  state.timers = []
}
