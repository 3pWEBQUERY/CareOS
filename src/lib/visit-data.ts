import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, fmtDayMonth, fmtNum, fmtRel, hm, startOfDay } from '@/lib/time'
import { abnormalKeys, flag, LIVE, mergeLimits, VITALS, type Limits } from '@/lib/vitals'
import { vitalChanges, visitSince } from '@/lib/visit'
import type { VisitQuestionDto, VisitRefOptionDto, VisitRosterDto } from '@/components/visit/types'

/** Bezüge werden gespeichert: immer mit Datum. */
const full = (d: Date, locale: Ctx['locale']) => fmtDayMonth(d, locale) + ' ' + hm(d)
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export async function limitsFor(ctx: Ctx, residentId: string) {
  const rows = await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId }] } })
  return mergeLimits(rows, residentId)
}

/** Kurztext eines Vitalwerts als Bezug: «SpO₂ 89 % ▼, Temperatur 38,1 °C ▲ · 14:10». Ohne auffällige Werte alle erfassten Werte. */
export function vitalRefLabel(ctx: Ctx, v: Parameters<typeof abnormalKeys>[0] & { at: Date }, limits: Limits) {
  const keys = abnormalKeys(v, limits)
  const shown = keys.length ? keys : (Object.keys(VITALS) as (keyof typeof VITALS)[]).filter((k) => v[k] != null)
  const parts = shown.slice(0, 3).map((k) => {
    const f = flag(k, v[k] as number, limits)
    return `${ctx.t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, ctx.locale)} ${VITALS[k].unit}${f === 'hi' ? ' ▲' : f === 'lo' ? ' ▼' : ''}`
  })
  return `${parts.join(', ')} · ${full(v.at, ctx.locale)}`
}
export function noteRefLabel(ctx: Ctx, o: { at: Date; category: string; text: string }) {
  return `${ctx.t('chart.cat.' + o.category)} · ${full(o.at, ctx.locale)} · ${short(o.text, 70)}`
}

/** Auswahl für «Bezug» beim Vormerken: auffällige Vitalwerte und Verlaufseinträge der letzten 7 Tage. */
export async function askRefOptions(ctx: Ctx, residentId: string, now = new Date()): Promise<VisitRefOptionDto[]> {
  const from = addDays(now, -7)
  const [vitals, obs, limits] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId, at: { gte: from }, ...LIVE }, orderBy: { at: 'desc' }, take: 40 }),
    db.observation.findMany({ where: { residentId, at: { gte: from }, correctedBy: { none: {} }, category: { not: 'handover' } }, orderBy: { at: 'desc' }, take: 10 }),
    limitsFor(ctx, residentId),
  ])
  const ab = vitals.filter((v) => abnormalKeys(v, limits).length).slice(0, 6)
  return [
    ...ab.map((v) => ({ value: 'vital:' + v.id, group: 'vital' as const, label: vitalRefLabel(ctx, v, limits) })),
    ...obs.map((o) => ({ value: 'observation:' + o.id, group: 'observation' as const, label: noteRefLabel(ctx, o) })),
  ]
}

/** Offene Fragen einer oder mehrerer Personen, neueste zuletzt (Reihenfolge der Erfassung). */
export async function openQuestions(ctx: Ctx, residentIds: string[], now = new Date()) {
  const qs = await db.visitQuestion.findMany({ where: { orgId: ctx.org.id, residentId: { in: residentIds }, status: 'open' }, orderBy: { createdAt: 'asc' } })
  const users = await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(qs.map((q) => q.createdById))] } }, select: { id: true, firstName: true, lastName: true } })
  const name = (id: string) => { const u = users.find((x) => x.id === id); return u ? `${u.firstName.charAt(0)}. ${u.lastName}` : '–' }
  const rel = (d: Date) => fmtRel(d, { today: ctx.t('common.today'), yesterday: ctx.t('common.yesterday') }, now, ctx.locale)
  return qs.map((q) => ({
    residentId: q.residentId,
    dto: {
      id: q.id, text: q.text, by: name(q.createdById), when: rel(q.createdAt), mine: q.createdById === ctx.user.id,
      ref: q.refType && q.refLabel ? { type: q.refType as 'vital' | 'observation', label: q.refLabel, href: `/residents/${q.residentId}/${q.refType === 'vital' ? 'vitals' : 'notes'}` } : null,
    } satisfies VisitQuestionDto,
  }))
}

/**
 * Personen der Visite im Bereich: Arzttermin heute, offene Fragen oder heute bereits dokumentiert.
 * `extraId` (frei gewählte Person) wird ergänzt. Reihenfolge wie in Akte und Medikamentenrunde (Zimmer, Name).
 */
export async function visitRoster(ctx: Ctx, unitId: string, extraId: string | null, now = new Date()) {
  const day = startOfDay(now)
  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, unitId, status: { in: ['active', 'absent'] } },
    select: { id: true, firstName: true, lastName: true, allergies: true, room: { select: { number: true } } },
    orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
  })
  const ids = residents.map((r) => r.id)
  const [appts, qCounts, visits] = await Promise.all([
    db.appointment.findMany({ where: { residentId: { in: ids }, kind: 'physician', at: { gte: day, lt: addDays(day, 1) } }, orderBy: { at: 'asc' } }),
    db.visitQuestion.groupBy({ by: ['residentId'], where: { orgId: ctx.org.id, residentId: { in: ids }, status: 'open' }, _count: { _all: true } }),
    db.visit.findMany({ where: { orgId: ctx.org.id, residentId: { in: ids }, at: { gte: day, lt: addDays(day, 1) } }, select: { residentId: true } }),
  ])
  const rows: VisitRosterDto[] = []
  for (const r of residents) {
    const a = appts.find((x) => x.residentId === r.id)
    const q = qCounts.find((x) => x.residentId === r.id)?._count._all ?? 0
    const done = visits.some((v) => v.residentId === r.id)
    if (!a && !q && !done && r.id !== extraId) continue
    rows.push({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, at: a ? hm(a.at) : null, questions: q, done, href: `/tasks/visit?r=${r.id}`, allergy: r.allergies.length > 0 })
  }
  return { rows, residents: residents.map((r) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null })), appointments: appts }
}

/** Veränderungen seit der letzten Visite für die Personenansicht (PRD §47: Information vor Navigation). */
export async function visitChanges(ctx: Ctx, residentId: string, canMeds: boolean, now = new Date()) {
  const day = startOfDay(now)
  const [lastVisit, lastAppt] = await Promise.all([
    db.visit.findFirst({ where: { residentId, at: { lt: day } }, orderBy: { at: 'desc' }, select: { at: true } }),
    db.appointment.findFirst({ where: { residentId, kind: 'physician', done: true, at: { lt: day } }, orderBy: { at: 'desc' }, select: { at: true } }),
  ])
  const { since, fromVisit } = visitSince([lastVisit?.at, lastAppt?.at], now)
  const [vitals, limits, notes, started, stopped, missed] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId, at: { gte: since }, ...LIVE }, orderBy: { at: 'asc' } }),
    limitsFor(ctx, residentId),
    db.observation.findMany({
      where: { residentId, at: { gte: since }, correctedBy: { none: {} }, OR: [{ important: true }, { category: { in: ['observation', 'incident', 'physician'] } }] },
      orderBy: { at: 'desc' }, take: 8,
    }),
    canMeds ? db.medication.findMany({ where: { residentId, createdAt: { gte: since } }, select: { id: true, name: true, createdAt: true } }) : [],
    canMeds ? db.medication.findMany({ where: { residentId, stoppedAt: { gte: since } }, select: { id: true, name: true, stoppedAt: true } }) : [],
    canMeds ? db.medicationAdministration.findMany({ where: { residentId, voidedAt: null, status: { in: ['refused', 'omitted', 'held'] }, at: { gte: since } }, select: { medicationId: true, medication: { select: { name: true } } } }) : [],
  ])
  const missedBy = new Map<string, { name: string; n: number }>()
  for (const a of missed) missedBy.set(a.medicationId, { name: a.medication.name, n: (missedBy.get(a.medicationId)?.n ?? 0) + 1 })
  return {
    since, fromVisit, limits,
    vitals: vitalChanges(vitals, limits, since),
    notes,
    meds: [
      ...started.map((m) => ({ key: 's' + m.id, at: m.createdAt, text: ctx.t('visit.person.medStarted', { name: m.name }), tone: 'violet' })),
      ...stopped.map((m) => ({ key: 'x' + m.id, at: m.stoppedAt!, text: ctx.t('visit.person.medStopped', { name: m.name }), tone: 'violet' })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()),
    missed: [...missedBy.entries()].map(([id, m]) => ({ key: 'm' + id, text: ctx.t('visit.person.medMissed', { name: m.name, n: m.n }) })),
  }
}

/** Heute dokumentierte Visiten einer Person mit Anordnungen und Stand der Aufgaben. */
export async function visitsToday(ctx: Ctx, residentId: string, now = new Date()) {
  const day = startOfDay(now)
  const visits = await db.visit.findMany({ where: { orgId: ctx.org.id, residentId, at: { gte: day, lt: addDays(day, 1) } }, include: { orders: true, questions: { select: { id: true, text: true, answer: true } } }, orderBy: { at: 'asc' } })
  const taskIds = visits.flatMap((v) => v.orders.map((o) => o.taskId).filter((x): x is string => !!x))
  const [tasks, users] = await Promise.all([
    taskIds.length ? db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true, dueAt: true } }) : [],
    db.user.findMany({ where: { orgId: ctx.org.id, id: { in: visits.map((v) => v.createdById) } }, select: { id: true, firstName: true, lastName: true } }),
  ])
  return visits.map((v) => {
    const u = users.find((x) => x.id === v.createdById)
    return { ...v, by: u ? `${u.firstName.charAt(0)}. ${u.lastName}` : '–', orders: v.orders.map((o) => ({ ...o, task: tasks.find((k) => k.id === o.taskId) ?? null })) }
  })
}
