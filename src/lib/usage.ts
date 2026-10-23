import 'server-only'
import { db } from '@/lib/db'

/**
 * Produktkennzahlen (PRD §63–§65), datensparsam: nur Summen aus vorhandenen Daten (Audit-Protokoll, Aufgaben,
 * Übergaben), keine neue Erfassung von Nutzungsdaten, keine Auswertung einzelner Personen.
 * Kleine Gruppen (< MIN_GROUP Personen) werden ohne Zahl ausgewiesen.
 */
export { MIN_GROUP, MODULES, adoption, median, TIME_RETURNED_ASSUMPTIONS } from '@/lib/usage-core'
import { adoption, timeReturned } from '@/lib/usage-core'

export async function usageReport(orgId: string, now = new Date()) {
  const day = (n: number) => new Date(now.getTime() - n * 24 * 3600_000)
  const d1 = new Date(now)
  d1.setHours(0, 0, 0, 0)
  const [active] = await db.$queryRaw<{ dau: bigint; wau: bigint; mau: bigint }[]>`
    SELECT count(DISTINCT "userId") FILTER (WHERE at >= ${d1}) AS dau,
           count(DISTINCT "userId") FILTER (WHERE at >= ${day(7)}) AS wau,
           count(DISTINCT "userId") AS mau
    FROM "AuditLog" WHERE "orgId" = ${orgId} AND "userId" IS NOT NULL AND at >= ${day(30)}`
  const trend = await db.$queryRaw<{ d: string; n: bigint }[]>`
    SELECT to_char((at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Zurich', 'YYYY-MM-DD') AS d, count(DISTINCT "userId") AS n
    FROM "AuditLog" WHERE "orgId" = ${orgId} AND "userId" IS NOT NULL AND at >= ${day(14)}
    GROUP BY 1 ORDER BY 1`
  const pairs = await db.$queryRaw<{ action: string; userId: string; n: bigint }[]>`
    SELECT action, "userId", count(*) AS n FROM "AuditLog"
    WHERE "orgId" = ${orgId} AND "userId" IS NOT NULL AND at >= ${day(30)}
    GROUP BY action, "userId"`
  const accounts = await db.user.count({ where: { orgId, active: true } })
  // Zeit bis zur Quittung (erledigte Aufgaben, 30 Tage): Minuten von Fälligkeit bis Quittung, früher quittiert = 0
  const [ack] = await db.$queryRaw<{ med: number | null; ontime: bigint; total: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(0, EXTRACT(EPOCH FROM ("completedAt" - "dueAt")) / 60)) AS med,
           count(*) FILTER (WHERE "completedAt" <= "dueAt" + interval '30 minutes') AS ontime,
           count(*) AS total
    FROM "Task" WHERE "orgId" = ${orgId} AND status = 'done' AND "completedAt" >= ${day(30)}`
  // Übergabe: Abschliessen bis zur ersten Übernahme (30 Tage)
  const [ho] = await db.$queryRaw<{ med: number | null; n: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY mins) AS med, count(*) AS n FROM (
      SELECT EXTRACT(EPOCH FROM (min(a.at) - h."submittedAt")) / 60 AS mins
      FROM "Handover" h JOIN "Unit" u ON u.id = h."unitId"
      JOIN "Acknowledgement" a ON a."subjectType" = 'handover' AND a."subjectId" = h.id AND a.at >= h."submittedAt"
      WHERE u."orgId" = ${orgId} AND h."submittedAt" >= ${day(30)}
      GROUP BY h.id, h."submittedAt"
    ) x`
  const [fb] = await db.$queryRaw<{ avg: number | null; n: bigint }[]>`
    SELECT avg(rating)::float AS avg, count(rating) AS n FROM "Feedback" WHERE "orgId" = ${orgId} AND kind = 'rating' AND "createdAt" >= ${day(90)}`
  return {
    dau: Number(active?.dau ?? 0),
    wau: Number(active?.wau ?? 0),
    mau: Number(active?.mau ?? 0),
    accounts,
    trend: trend.map((r) => ({ day: r.d, n: Number(r.n) })),
    adoption: adoption(pairs.map((p) => ({ action: p.action, userId: p.userId, n: Number(p.n) }))),
    ack: { medianMin: ack?.med != null ? Math.round(Number(ack.med)) : null, onTime: Number(ack?.ontime ?? 0), total: Number(ack?.total ?? 0) },
    handover: { medianMin: ho?.med != null ? Math.round(Number(ho.med)) : null, n: Number(ho?.n ?? 0) },
    rating: { avg: fb?.avg ?? null, n: Number(fb?.n ?? 0) },
  }
}

/** Daten für die Schätzung «Time returned to care» (30 Tage, nur Zählwerte). */
export async function timeReturnedReport(orgId: string, now = new Date()) {
  const from = new Date(now.getTime() - 30 * 24 * 3600_000)
  const [[bulk], handover, ai, voice, docOnce, [active]] = await Promise.all([
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "AuditLog" WHERE "orgId" = ${orgId} AND action = 'task.complete' AND at >= ${from} AND context ? 'bulk' AND NOT (context ? 'backlog')`,
    db.handover.count({ where: { unit: { orgId }, submittedAt: { gte: from } } }),
    db.aiInteraction.count({ where: { orgId, accepted: true, createdAt: { gte: from } } }),
    db.observation.count({ where: { resident: { orgId }, source: 'voice', at: { gte: from } } }),
    db.task.count({ where: { orgId, status: 'done', completedById: { not: null }, completedAt: { gte: from }, OR: [{ source: 'medication' }, { source: 'assessment' }, { source: 'careplan', sourceId: { startsWith: 'eval:' } }] } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "userId") AS n FROM "AuditLog" WHERE "orgId" = ${orgId} AND "userId" IS NOT NULL AND action = 'task.complete' AND at >= ${from}`,
  ])
  return timeReturned({ bulk: Number(bulk?.n ?? 0), handover, aiAccepted: ai, voice, documentOnce: docOnce }, Number(active?.n ?? 0))
}
