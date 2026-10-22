import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { isClosed, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { addDays, dbDate, fmtDayMonth, fmtNum, hm, sameDay, shiftBounds, startOfDay, type ShiftDef } from '@/lib/time'
import { abnormalKeys, flag, mergeLimits, VITALS } from '@/lib/vitals'
import { EFFECT_CHECK_MIN, openDoses } from '@/lib/medication'
import { doseText } from '@/components/meds/dose'

export type Tone = 'c' | 'w' | ''
export type Item = { text: string; time?: string; tone?: Tone; muted?: boolean }
export type Block = {
  resident: { id: string; firstName: string; lastName: string; room: string | null; careLevel: number | null; rea: string; allergies: string[]; risks: string[] }
  happened: Item[]
  done: Item[]
  watch: Item[]
  open: Item[]
  entry: { watch: string | null; open: string | null; important: boolean; author: string | null } | null
  counts: { notes: number; open: number; abnormal: number }
}

export type Occurrence = { def: ShiftDef; start: Date; end: Date }

/** Alle Schichten, die gestern, heute oder morgen beginnen. */
export function occurrences(types: ShiftDef[], now = new Date()): Occurrence[] {
  const out: Occurrence[] = []
  for (const d of [-1, 0, 1]) for (const def of types) out.push({ def, ...shiftBounds(def, addDays(startOfDay(now), d)) })
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Laufende Schicht (bei Überlappung die später begonnene) und die vorangehende. */
export function runningAndPrevious(types: ShiftDef[], now = new Date()) {
  const occ = occurrences(types, now)
  const running = occ.filter((o) => o.start <= now && now < o.end).sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? null
  const ref = running?.start ?? now
  const previous = occ.filter((o) => o.start < ref && o.end <= (running ? running.end : now)).sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? null
  return { running, previous, occ }
}

const short = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 2).trimEnd() + ' …' : s)

/**
 * Automatische Übergabe (PRD §11.1): sammelt pro Person Dokumentation, Vitalwerte, Medikation, Ereignisse,
 * Aufgaben, Wunden, Ernährung und Termine im Zeitfenster und ordnet sie den vier Fragen zu (§11.2).
 */
export async function collectHandover(ctx: Ctx, unitId: string, from: Date, to: Date, handoverId: string | null, now = new Date()) {
  const { t, locale } = ctx
  const residents = await db.resident.findMany({
    where: { unitId, orgId: ctx.org.id, status: { in: ['active', 'absent'] } },
    include: { room: true },
    orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
  })
  const rIds = residents.map((r) => r.id)
  const until = to < now ? to : now
  // Nicht dokumentierte Dosen gelten nur 24 h als "offen"; ältere Lücken gehören nicht in die Übergabe.
  const doseFrom = new Date(Math.max(from.getTime(), now.getTime() - 24 * 3600_000))
  const days: Date[] = []
  for (let d = startOfDay(doseFrom); d < to && days.length < 3; d = addDays(d, 1)) days.push(d)

  const [observations, vitals, limits, incidents, medIssues, prnGiven, tasks, woundEntries, intake, appointments, assessments, entries, prevHandover, users] = await Promise.all([
    db.observation.findMany({ where: { residentId: { in: rIds }, at: { gte: from, lt: until }, correctedBy: { none: {} }, category: { not: 'handover' } }, orderBy: { at: 'asc' } }),
    db.vitalSign.findMany({ where: { residentId: { in: rIds }, at: { gte: from, lt: until } }, orderBy: { at: 'asc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: { in: rIds } }] } }),
    db.incident.findMany({ where: { unitId, orgId: ctx.org.id, occurredAt: { gte: from, lt: until } }, include: { type: true } }),
    db.medicationAdministration.findMany({ where: { residentId: { in: rIds }, voidedAt: null, status: { in: ['refused', 'omitted', 'held'] }, OR: [{ scheduledFor: { gte: from, lt: to } }, { scheduledFor: null, at: { gte: from, lt: until } }] }, include: { medication: true } }),
    db.medicationAdministration.findMany({ where: { residentId: { in: rIds }, voidedAt: null, status: 'given', scheduledFor: null, at: { gte: addDays(from, -1), lt: until } }, include: { medication: true } }),
    db.task.findMany({ where: { unitId, residentId: { in: rIds }, dueAt: { gte: from, lt: to } }, orderBy: { dueAt: 'asc' } }),
    db.woundAssessment.findMany({ where: { wound: { residentId: { in: rIds } }, at: { gte: from, lt: until } }, include: { wound: true }, orderBy: { at: 'asc' } }),
    db.intakeLog.findMany({ where: { residentId: { in: rIds }, at: { gte: from, lt: until } } }),
    db.appointment.findMany({ where: { residentId: { in: rIds }, at: { gte: from, lt: addDays(to, 1) } }, orderBy: { at: 'asc' } }),
    db.assessment.findMany({ where: { residentId: { in: rIds }, at: { gte: from, lt: until } } }),
    handoverId ? db.handoverEntry.findMany({ where: { handoverId } }) : Promise.resolve([]),
    db.handover.findFirst({ where: { unitId, submittedAt: { gte: addDays(from, -2), lt: new Date(from.getTime() + 3 * 3600_000) }, date: { lte: dbDate(from) }, ...(handoverId ? { id: { not: handoverId } } : {}) }, orderBy: { submittedAt: 'desc' }, include: { entries: true } }),
    db.user.findMany({ where: { orgId: ctx.org.id }, select: { id: true, initials: true } }),
  ])
  let doses: Awaited<ReturnType<typeof openDoses>> = []
  for (const d of days) doses = doses.concat(await openDoses(rIds, d, now, { from: doseFrom, to, includeUpcoming: true }))
  const ini = (id: string | null) => (id ? users.find((u) => u.id === id)?.initials ?? '' : '')
  const prevEntries = prevHandover?.entries ?? []
  const stamp = (d: Date) => (sameDay(d, now) ? hm(d) : fmtDayMonth(d, locale) + ' ' + hm(d))
  const assessName = (key: string) => {
    const n = t('care.assessments.names.' + key)
    return n.startsWith('care.') ? key : n
  }

  const blocks: Block[] = residents.map((r) => {
    const happened: (Item & { at: number })[] = []
    const done: (Item & { at: number })[] = []
    const watch: Item[] = []
    const open: (Item & { at: number })[] = []
    const lim = mergeLimits(limits, r.id)
    let abnormal = 0

    for (const o of observations.filter((o) => o.residentId === r.id)) {
      happened.push({ at: o.at.getTime(), time: stamp(o.at), text: short(o.text), tone: o.category === 'incident' ? 'c' : o.important ? 'w' : '' })
    }
    for (const i of incidents.filter((i) => i.residentId === r.id)) {
      happened.push({ at: i.occurredAt.getTime(), time: stamp(i.occurredAt), text: t('tasks.handover.auto.incident', { type: i.type.name, text: short(i.description, 90) }), tone: 'c' })
    }
    for (const v of vitals.filter((v) => v.residentId === r.id)) {
      const ab = abnormalKeys(v, lim)
      if (!ab.length) continue
      abnormal += ab.length
      happened.push({
        at: v.at.getTime(), time: stamp(v.at), tone: 'c',
        text: ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, locale)} ${VITALS[k].unit} ${flag(k, v[k] as number, lim) === 'hi' ? '▲' : '▼'}`).join(', '),
      })
    }
    for (const a of medIssues.filter((a) => a.residentId === r.id)) {
      const when = a.scheduledFor ?? a.at
      happened.push({ at: when.getTime(), time: hm(when), tone: 'w', text: t('tasks.handover.auto.med_' + a.status, { drug: a.medication.name }) + (a.note ? ' – ' + short(a.note, 60) : '') })
    }
    for (const a of appointments.filter((a) => a.residentId === r.id)) {
      if (a.at < until && a.at >= from) happened.push({ at: a.at.getTime(), time: stamp(a.at), text: t('tasks.handover.auto.appointment', { title: a.title }) })
      else if (a.at >= now) open.push({ at: a.at.getTime(), time: stamp(a.at), text: t('tasks.handover.auto.appointment', { title: a.title }) })
    }

    // Was wurde getan?
    for (const k of tasks.filter((k) => k.residentId === r.id && isClosed(k.status))) {
      if (k.source === 'medication' && k.title === 'medication.slot') continue
      done.push({ at: (k.completedAt ?? k.dueAt).getTime(), time: hm(k.dueAt), tone: k.status === 'done' ? '' : 'w', text: taskTitle(t, k) + (k.status === 'done' ? '' : ` (${t('tasks.view.' + k.status)}${k.note ? ': ' + short(k.note, 60) : ''})`) })
    }
    for (const a of prnGiven.filter((a) => a.residentId === r.id && a.at >= from)) {
      done.push({ at: a.at.getTime(), time: hm(a.at), text: t('tasks.handover.auto.prn', { drug: a.medication.name, dose: a.dose ?? '' }) + (a.effectNote ? ' · ' + a.effectNote : '') })
    }
    for (const w of woundEntries.filter((w) => w.wound.residentId === r.id)) {
      done.push({ at: w.at.getTime(), time: hm(w.at), text: t('tasks.handover.auto.wound', { site: w.wound.bodySite, kind: w.wound.kind }) + (w.treatment ? ': ' + short(w.treatment, 70) : '') })
    }
    for (const a of assessments.filter((a) => a.residentId === r.id)) {
      done.push({ at: a.at.getTime(), time: hm(a.at), text: t('tasks.handover.auto.assessment', { name: assessName(a.key), result: [a.score != null ? fmtNum(a.score, 0, locale) : null, a.result].filter(Boolean).join(' · ') }) })
    }
    const drinks = intake.filter((i) => i.residentId === r.id && i.kind === 'drink').reduce((s, i) => s + (i.amountMl ?? 0), 0)
    const meals = intake.filter((i) => i.residentId === r.id && i.kind === 'meal')
    if (drinks) done.push({ at: until.getTime(), text: t('tasks.handover.auto.fluids', { ml: drinks }) })
    if (meals.length) done.push({ at: until.getTime(), text: t('tasks.handover.auto.meals', { n: meals.length, list: meals.map((m) => [m.item, m.portion != null ? Math.round(m.portion * 100) + ' %' : null].filter(Boolean).join(' ')).join(', ') }) })

    // Was muss beobachtet werden?
    const entry = entries.find((e) => e.residentId === r.id) ?? null
    if (entry?.watch) watch.push({ text: entry.watch, tone: entry.important ? 'w' : '' })
    for (const a of prnGiven.filter((a) => a.residentId === r.id && !a.effectAt)) {
      const due = new Date(a.at.getTime() + EFFECT_CHECK_MIN * 60_000)
      watch.push({ time: hm(due), text: t('tasks.handover.auto.effect', { drug: a.medication.name }), tone: due < now ? 'c' : '' })
    }
    const prev = prevEntries.find((e) => e.residentId === r.id)
    if (prev?.watch) watch.push({ text: t('tasks.handover.auto.fromPrevious', { text: prev.watch }), muted: true })

    // Was ist noch offen?
    let openCount = 0
    for (const k of tasks.filter((k) => k.residentId === r.id && !isClosed(k.status))) {
      openCount++
      if (k.source === 'medication' && k.title === 'medication.slot') continue
      const v = taskView(k, now)
      open.push({ at: k.dueAt.getTime(), time: hm(k.dueAt), text: taskTitle(t, k) + (v === 'escalated' ? ` (${t('tasks.view.escalated')})` : ''), tone: v === 'over' || v === 'escalated' ? 'c' : '' })
    }
    for (const d of doses.filter((d) => d.residentId === r.id)) {
      open.push({ at: d.at.getTime(), time: d.time, text: t(d.over ? 'tasks.handover.auto.doseOver' : 'tasks.handover.auto.dosePlanned', { drug: d.medication.name, dose: doseText(d.dose, d.medication.form) }), tone: d.over ? 'c' : '' })
    }
    if (entry?.open) open.push({ at: Number.MAX_SAFE_INTEGER, text: entry.open, tone: entry.important ? 'w' : '' })

    const byTime = <T extends { at: number }>(a: T[]) => a.sort((x, y) => x.at - y.at).map(({ at: _at, ...rest }) => { void _at; return rest })
    return {
      resident: { id: r.id, firstName: r.firstName, lastName: r.lastName, room: r.room?.number ?? null, careLevel: r.careLevel, rea: r.rea, allergies: r.allergies, risks: r.risks },
      happened: byTime(happened), done: byTime(done), watch, open: byTime(open),
      entry: entry ? { watch: entry.watch, open: entry.open, important: entry.important, author: ini(entry.authorId) } : null,
      counts: { notes: observations.filter((o) => o.residentId === r.id).length, open: openCount, abnormal },
    }
  })
  return blocks
}

/** Reiner Text für die KI-Zusammenfassung – nur Fakten aus der Übergabe. */
export function handoverText(blocks: Block[], t: Ctx['t']) {
  const line = (i: Item) => `  - ${i.time ? i.time + ' ' : ''}${i.text}`
  return blocks
    .filter((b) => b.happened.length || b.open.length || b.watch.length)
    .map((b) => [
      `${t('tasks.handover.ai.room')} ${b.resident.room ?? '–'}, ${b.resident.lastName} ${b.resident.firstName.charAt(0)}.`,
      b.happened.length ? ` ${t('tasks.handover.cols.happened')}\n${b.happened.map(line).join('\n')}` : '',
      b.done.length ? ` ${t('tasks.handover.cols.done')}\n${b.done.slice(0, 8).map(line).join('\n')}` : '',
      b.watch.length ? ` ${t('tasks.handover.cols.watch')}\n${b.watch.map(line).join('\n')}` : '',
      b.open.length ? ` ${t('tasks.handover.cols.open')}\n${b.open.map(line).join('\n')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n')
}
