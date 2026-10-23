import 'server-only'
import { db } from '@/lib/db'
import { dateKey, fromDbDate } from '@/lib/time'
import { absenceNights, daysWithin, monthRange, type BillingRow } from '@/lib/billing-core'

export { monthRange, billingCsvRows, type BillingRow } from '@/lib/billing-core'

/**
 * Abrechnungsgrundlage je Person und Monat (PRD §40): Pflegestufe, Aufenthalts- und Abwesenheitstage, dokumentierte
 * Pflegeminuten und Leistungen je Kategorie. Personen der Bereiche, die im Monat anwesend waren (auch Ausgetretene).
 */
export async function billingRows(orgId: string, unitIds: string[], month: string): Promise<BillingRow[]> {
  const range = monthRange(month)
  if (!range) return []
  const { start, end } = range
  const residents = await db.resident.findMany({
    where: { orgId, unitId: { in: unitIds }, anonymisedAt: null, admittedAt: { lt: end }, OR: [{ dischargedAt: null }, { dischargedAt: { gte: start } }] },
    select: {
      id: true, firstName: true, lastName: true, birthDate: true, insuranceNo: true, careLevel: true, admittedAt: true, dischargedAt: true, unit: { select: { name: true } },
      episodes: { where: { kind: 'absence', start: { lt: end }, OR: [{ end: null }, { end: { gte: start } }] }, select: { start: true, end: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const ids = residents.map((r) => r.id)
  const tasks = ids.length
    ? await db.task.groupBy({ by: ['residentId', 'category'], where: { residentId: { in: ids }, status: { in: ['done', 'partial'] }, completedAt: { gte: start, lt: end } }, _sum: { durationMin: true }, _count: true })
    : []
  return residents.map((r) => {
    const own = tasks.filter((x) => x.residentId === r.id)
    const byCategory: Record<string, number> = {}
    for (const x of own) byCategory[x.category] = (byCategory[x.category] ?? 0) + (x._sum.durationMin ?? 0)
    return {
      lastName: r.lastName, firstName: r.firstName, birthDate: dateKey(fromDbDate(r.birthDate)), insuranceNo: r.insuranceNo, unit: r.unit.name, careLevel: r.careLevel,
      stayDays: daysWithin(r.admittedAt, r.dischargedAt, start, end),
      absenceDays: r.episodes.reduce((s, e) => s + absenceNights(e.start, e.end, start, end), 0),
      careMinutes: own.reduce((s, x) => s + (x._sum.durationMin ?? 0), 0),
      services: own.reduce((s, x) => s + x._count, 0),
      byCategory,
    }
  })
}
