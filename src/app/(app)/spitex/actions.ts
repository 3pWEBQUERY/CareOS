'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { getCtx, ForbiddenError, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { notifyT } from '@/lib/notify-t'
import { encrypt } from '@/lib/crypto'
import { addDays, atTime, dbDate, fmtDayMonth, fromDbDate, hm, parseDateKey, sameDay, startOfDay } from '@/lib/time'
import type { Permission } from '@/lib/permissions'
import type { VisitStepData } from '@/lib/offline/types'
import { PLAN_AHEAD_DAYS, clientSchema, isHomecare, moveInTour, servicesFromForm, templateSchema, tourOrder, visitSchema } from '@/lib/spitex'
import { canSeeAccess, invalidateVisitGeneration, openAccessNote, spitexStaff } from '@/lib/spitex-data'
import { applyVisitStep } from '@/lib/spitex-visit'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })
const unitOf = (ctx: Ctx, unitId: string) => ctx.units.find((u) => u.id === unitId && isHomecare(u)) ?? null

/** Klient/in im Einsatzgebiet mit dem verlangten Spitex-Recht, sonst ForbiddenError. */
async function client(ctx: Ctx, residentId: string, perm: Permission) {
  const r = await db.resident.findFirst({ where: { id: residentId, orgId: ctx.org.id, unitId: { in: ctx.unitIds } } })
  const unit = r ? unitOf(ctx, r.unitId) : null
  if (!r || !unit || !ctx.can(perm, { unitId: unit.id, locationId: unit.locationId })) throw new ForbiddenError(perm)
  return { r, unit }
}

async function visitForPlan(ctx: Ctx, visitId: string) {
  const v = await db.homeCareVisit.findFirst({ where: { id: visitId, orgId: ctx.org.id }, include: { services: true } })
  const unit = v ? unitOf(ctx, v.unitId) : null
  if (!v || !unit || !ctx.can('spitex.plan', { unitId: unit.id, locationId: unit.locationId })) throw new ForbiddenError('spitex.plan')
  return { v, unit }
}

/** Zugewiesene Person muss im Einsatzgebiet Einsätze durchführen dürfen. */
async function checkAssignee(ctx: Ctx, unit: { id: string; locationId: string }, id: string) {
  if (!id) return true
  return (await spitexStaff(ctx.org.id, unit)).some((s) => s.id === id)
}

const nameOf = (r: { firstName: string; lastName: string }) => `${r.lastName} ${r.firstName}`

/** Benachrichtigung bei Zuweisung für heute oder morgen (Tour ändert sich kurzfristig). */
async function notifyAssignee(ctx: Ctx, v: { id: string; assigneeId: string | null; plannedStart: Date; unitId: string }, r: { firstName: string; lastName: string }) {
  if (!v.assigneeId || v.assigneeId === ctx.user.id) return
  if (v.plannedStart > addDays(startOfDay(), 2) || v.plannedStart < new Date()) return
  await notifyT({
    orgId: ctx.org.id, userIds: [v.assigneeId], priority: 'info', kind: 'schedule.tour', titleKey: 'spitex.notify.assigned',
    vars: { name: nameOf(r), time: hm(v.plannedStart), day: sameDay(v.plannedStart, new Date()) ? ctx.t('common.today') : fmtDayMonth(v.plannedStart, ctx.locale) },
    href: '/spitex/tour', groupKey: 'spitex:tour:' + v.assigneeId, unitId: v.unitId,
  })
}

const visitFields = (form: FormData) => ({
  id: fd(form, 'id'), residentId: fd(form, 'residentId'), date: fd(form, 'date'), start: fd(form, 'start'), end: fd(form, 'end'),
  assigneeId: fd(form, 'assigneeId'), note: fd(form, 'note'), services: servicesFromForm((k) => form.getAll(k).map(String)),
})

/** Einsatz planen oder ändern (nur geplante Einsätze). Aus Vorlagen erzeugte Einsätze behalten ihren Tag. */
export async function saveVisitAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = visitSchema.parse(visitFields(form))
    const day = parseDateKey(p.date)
    const today = startOfDay()
    if (day < today || day > addDays(today, PLAN_AHEAD_DAYS)) return err('spitex.errors.dateRange', 'date')
    const prev = p.id ? await visitForPlan(ctx, p.id) : null
    if (prev && prev.v.status !== 'planned') return err('spitex.errors.notPlanned')
    if (prev?.v.templateId && !sameDay(fromDbDate(prev.v.date), day)) return err('spitex.errors.templateDay', 'date')
    const { r, unit } = await client(ctx, prev ? prev.v.residentId : p.residentId, 'spitex.plan')
    if (!(await checkAssignee(ctx, unit, p.assigneeId))) return err('spitex.errors.assignee', 'assigneeId')
    const plannedStart = atTime(day, p.start)
    const plannedEnd = atTime(day, p.end)
    const assigneeId = p.assigneeId || null
    const services = p.services.map((s, i) => ({ klv: s.klv, label: s.label, plannedMin: s.minutes, order: i }))
    let sequence = prev?.v.sequence ?? 0
    if (!prev || prev.v.assigneeId !== assigneeId) {
      const last = await db.homeCareVisit.findFirst({ where: { unitId: unit.id, date: dbDate(day), assigneeId }, orderBy: { sequence: 'desc' }, select: { sequence: true } })
      sequence = (last?.sequence ?? -1) + 1
    }
    const data = { date: dbDate(day), plannedStart, plannedEnd, assigneeId, note: p.note || null, sequence }
    const saved = await db.$transaction(async (tx) => {
      if (prev) {
        await tx.homeCareService.deleteMany({ where: { visitId: prev.v.id } })
        const u = await tx.homeCareVisit.update({ where: { id: prev.v.id }, data: { ...data, services: { create: services } } })
        await audit(ctx, { action: 'spitex.visit.update', entityType: 'HomeCareVisit', entityId: u.id, before: { ...prev.v, services: prev.v.services.map((s) => ({ klv: s.klv, label: s.label, plannedMin: s.plannedMin })) }, after: { ...data, services }, context: { residentId: r.id } }, tx)
        return u
      }
      const c = await tx.homeCareVisit.create({ data: { ...data, orgId: ctx.org.id, unitId: unit.id, residentId: r.id, createdById: ctx.user.id, services: { create: services } } })
      await audit(ctx, { action: 'spitex.visit.create', entityType: 'HomeCareVisit', entityId: c.id, after: { ...data, services }, context: { residentId: r.id } }, tx)
      return c
    })
    if (saved.assigneeId !== prev?.v.assigneeId) await notifyAssignee(ctx, saved, r)
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: r.id, actorId: ctx.user.id, payload: { visitId: saved.id } })
    refresh()
    return { ok: true, message: ctx.t(prev ? 'spitex.toast.visitSaved' : 'spitex.toast.visitCreated', { name: nameOf(r) }) }
  })
}

/** Zuweisen (oder zurück in die offene Liste): ans Ende der Tour der Person. */
export async function assignVisitAction(visitId: string, assigneeId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { v, unit } = await visitForPlan(ctx, visitId)
    if (v.status !== 'planned') return err('spitex.errors.notPlanned')
    const target = assigneeId || null
    if (target === v.assigneeId) return { ok: true }
    if (!(await checkAssignee(ctx, unit, assigneeId))) return err('spitex.errors.assignee')
    const last = await db.homeCareVisit.findFirst({ where: { unitId: unit.id, date: v.date, assigneeId: target }, orderBy: { sequence: 'desc' }, select: { sequence: true } })
    const u = await db.homeCareVisit.update({ where: { id: v.id }, data: { assigneeId: target, sequence: (last?.sequence ?? -1) + 1 } })
    await audit(ctx, { action: 'spitex.visit.assign', entityType: 'HomeCareVisit', entityId: v.id, before: { assigneeId: v.assigneeId }, after: { assigneeId: target }, context: { residentId: v.residentId } })
    const r = await db.resident.findUniqueOrThrow({ where: { id: v.residentId }, select: { firstName: true, lastName: true } })
    await notifyAssignee(ctx, u, r)
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: v.residentId, actorId: ctx.user.id, payload: { visitId: v.id, assigneeId: target } })
    refresh()
    return { ok: true, message: ctx.t(target ? 'spitex.toast.assigned' : 'spitex.toast.unassigned', { name: nameOf(r) }) }
  })
}

/** Reihenfolge in der Tour: eine Position früher oder später. */
export async function moveVisitAction(visitId: string, dir: -1 | 1): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { v, unit } = await visitForPlan(ctx, visitId)
    const tour = tourOrder(await db.homeCareVisit.findMany({ where: { unitId: unit.id, date: v.date, assigneeId: v.assigneeId }, select: { id: true, sequence: true, plannedStart: true } }))
    const ids = moveInTour(tour.map((x) => x.id), v.id, dir === -1 ? -1 : 1)
    await db.$transaction(ids.map((id, i) => db.homeCareVisit.update({ where: { id }, data: { sequence: i } })))
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: v.residentId, actorId: ctx.user.id, payload: { visitId: v.id, moved: dir } })
    refresh()
  })
}

/** Einsatz absagen (bleibt sichtbar und wird nicht neu erzeugt). */
export async function cancelVisitAction(visitId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const { v, unit } = await visitForPlan(ctx, visitId)
    if (v.status !== 'planned') return err('spitex.errors.notPlanned')
    await db.homeCareVisit.update({ where: { id: v.id }, data: { status: 'cancelled' } })
    await audit(ctx, { action: 'spitex.visit.cancel', entityType: 'HomeCareVisit', entityId: v.id, before: { status: v.status }, after: { status: 'cancelled' }, context: { residentId: v.residentId } })
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: v.residentId, actorId: ctx.user.id, payload: { visitId: v.id, status: 'cancelled' } })
    refresh()
    return { ok: true, message: 'spitex.toast.cancelled' }
  })
}

/**
 * Wochenvorlage anlegen oder ändern. Bereits erzeugte, noch nicht begonnene Einsätze dieser Vorlage ab jetzt werden
 * verworfen und neu erzeugt; begonnene, erledigte und abgesagte bleiben.
 */
export async function saveTemplateAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = templateSchema.parse({
      id: fd(form, 'id'), residentId: fd(form, 'residentId'), weekdays: form.getAll('weekdays').map(String), start: fd(form, 'start'), end: fd(form, 'end'),
      preferredUserId: fd(form, 'preferredUserId'), startDate: fd(form, 'startDate'), endDate: fd(form, 'endDate'), note: fd(form, 'note'),
      services: servicesFromForm((k) => form.getAll(k).map(String)),
    })
    const prev = p.id ? await db.homeCareTemplate.findFirst({ where: { id: p.id, orgId: ctx.org.id } }) : null
    if (p.id && !prev) return err('common.notFound')
    const { r, unit } = await client(ctx, prev?.residentId ?? p.residentId, 'spitex.plan')
    if (!(await checkAssignee(ctx, unit, p.preferredUserId))) return err('spitex.errors.assignee', 'preferredUserId')
    const data = {
      weekdays: [...new Set(p.weekdays)].sort(), start: p.start, end: p.end, preferredUserId: p.preferredUserId || null, note: p.note || null,
      startDate: dbDate(parseDateKey(p.startDate)), endDate: p.endDate ? dbDate(parseDateKey(p.endDate)) : null,
      services: p.services.map((s) => ({ klv: s.klv, label: s.label, minutes: s.minutes })),
    }
    const now = new Date()
    const saved = await db.$transaction(async (tx) => {
      if (prev) {
        const u = await tx.homeCareTemplate.update({ where: { id: prev.id }, data: { ...data, active: true } })
        const dropped = await tx.homeCareVisit.deleteMany({ where: { templateId: prev.id, status: 'planned', plannedStart: { gt: now } } })
        await audit(ctx, { action: 'spitex.template.update', entityType: 'HomeCareTemplate', entityId: u.id, before: prev, after: data, context: { residentId: r.id, regenerated: dropped.count } }, tx)
        return u
      }
      const c = await tx.homeCareTemplate.create({ data: { ...data, orgId: ctx.org.id, residentId: r.id, createdById: ctx.user.id } })
      await audit(ctx, { action: 'spitex.template.create', entityType: 'HomeCareTemplate', entityId: c.id, after: data, context: { residentId: r.id } }, tx)
      return c
    })
    await invalidateVisitGeneration(unit.id)
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: r.id, actorId: ctx.user.id, payload: { templateId: saved.id } })
    refresh()
    return { ok: true, message: ctx.t('spitex.toast.templateSaved', { name: nameOf(r) }) }
  })
}

/** Wochenvorlage beenden: keine neuen Einsätze, künftige geplante werden entfernt. */
export async function endTemplateAction(templateId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const tpl = await db.homeCareTemplate.findFirst({ where: { id: templateId, orgId: ctx.org.id } })
    if (!tpl) return err('common.notFound')
    const { r, unit } = await client(ctx, tpl.residentId, 'spitex.plan')
    const now = new Date()
    await db.$transaction(async (tx) => {
      await tx.homeCareTemplate.update({ where: { id: tpl.id }, data: { active: false, endDate: dbDate(now) } })
      const dropped = await tx.homeCareVisit.deleteMany({ where: { templateId: tpl.id, status: 'planned', plannedStart: { gt: now } } })
      await audit(ctx, { action: 'spitex.template.end', entityType: 'HomeCareTemplate', entityId: tpl.id, before: { active: tpl.active, endDate: tpl.endDate }, after: { active: false, endDate: dbDate(now) }, context: { residentId: r.id, removedVisits: dropped.count } }, tx)
    })
    await invalidateVisitGeneration(unit.id)
    await emit({ orgId: ctx.org.id, type: 'homecare.updated', unitId: unit.id, residentId: r.id, actorId: ctx.user.id, payload: { templateId: tpl.id, ended: true } })
    refresh()
    return { ok: true, message: 'spitex.toast.templateEnded' }
  })
}

/** Einsatzort, Telefon und Zugang. Der Zugang wird verschlüsselt gespeichert und nie ins Audit geschrieben. */
export async function saveClientAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const p = clientSchema.parse({
      residentId: fd(form, 'residentId'), street: fd(form, 'street'), postalCode: fd(form, 'postalCode'), city: fd(form, 'city'), phone: fd(form, 'phone'),
      accessNote: fd(form, 'accessNote'), clearAccess: fdBool(form, 'clearAccess'),
    })
    const { r } = await client(ctx, p.residentId, 'spitex.plan')
    const data: { street: string | null; postalCode: string | null; city: string | null; phone: string | null; accessNote?: string | null } = {
      street: p.street || null, postalCode: p.postalCode || null, city: p.city || null, phone: p.phone || null,
    }
    let access: 'changed' | 'removed' | null = null
    if (p.clearAccess) { data.accessNote = null; access = r.accessNote ? 'removed' : null }
    else if (p.accessNote) { data.accessNote = encrypt(p.accessNote); access = 'changed' }
    await db.resident.update({ where: { id: r.id }, data })
    const before = { street: r.street, postalCode: r.postalCode, city: r.city, phone: r.phone }
    const after = { street: data.street, postalCode: data.postalCode, city: data.city, phone: data.phone }
    await audit(ctx, { action: 'spitex.client.update', entityType: 'Resident', entityId: r.id, before, after: { ...after, ...(access ? { accessNote: access } : {}) }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { fields: ['address', ...(access ? ['accessNote'] : [])] } })
    refresh()
    return { ok: true, message: ctx.t('spitex.toast.clientSaved', { name: nameOf(r) }) }
  })
}

/** Zugang anzeigen (Türcode, Schlüsselbox): nur mit Spitex-Recht im Einsatzgebiet, jede Anzeige im Audit. */
export async function revealAccessAction(residentId: string): Promise<ActionResult<{ text: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await db.resident.findFirst({ where: { id: residentId, orgId: ctx.org.id, unitId: { in: ctx.unitIds } }, select: { id: true, unitId: true, accessNote: true } })
    const unit = r ? unitOf(ctx, r.unitId) : null
    if (!r || !unit || !canSeeAccess(ctx, unit)) throw new ForbiddenError('spitex.document')
    const text = openAccessNote(r.accessNote)
    if (!text) return { ok: false, error: 'spitex.access.none' }
    // Klartext (Import, Demodaten) beim ersten Abruf verschlüsseln
    if (!r.accessNote!.startsWith('v1.')) await db.resident.update({ where: { id: r.id }, data: { accessNote: encrypt(text) } })
    await audit(ctx, { action: 'spitex.access.view', entityType: 'Resident', entityId: r.id, context: { residentId: r.id } })
    return { ok: true, data: { text } }
  })
}

/** Meine Tour: Einsatz beginnen, abschliessen oder «nicht angetroffen» (gleiche Regeln wie offline). */
export async function visitStepAction(d: VisitStepData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    if (!d || typeof d.visitId !== 'string' || !['start', 'finish', 'missed'].includes(d.step)) return err('common.genericError')
    const res = await applyVisitStep(ctx, {
      visitId: d.visitId.slice(0, 40), step: d.step, note: typeof d.note === 'string' ? d.note.slice(0, 2000) : undefined,
      services: Array.isArray(d.services) ? d.services.slice(0, 12).map((s) => ({ id: String(s.id).slice(0, 40), done: !!s.done, minutes: typeof s.minutes === 'number' ? s.minutes : null })) : undefined,
    }, new Date())
    if (!res.ok) {
      if (res.reason === 'forbidden') throw new ForbiddenError('spitex.document')
      refresh()
      return err(ctx.t('spitex.errors.step.' + res.reason, { by: res.detail?.by ?? '–', at: res.detail?.at ? hm(new Date(res.detail.at)) : '–' }))
    }
    refresh()
    return { ok: true, message: res.duplicate ? undefined : res.message }
  })
}
