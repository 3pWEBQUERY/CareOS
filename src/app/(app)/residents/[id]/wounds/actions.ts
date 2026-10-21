'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { ForbiddenError, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { fd, fdNum, run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { saveUpload, UploadError } from '@/lib/files'
import { invalidateTaskGeneration, OPEN_STATUSES } from '@/lib/tasks'
import { addDays, dateKey, parseDateKey, startOfDay } from '@/lib/time'
import { EDGE, EXUDATE, TISSUE, WOUND_KINDS, WOUND_ORIGINS } from '@/lib/care'

async function load(residentId: string) {
  const ctx = await getCtx()
  const r = await residentInScope(ctx, residentId, 'resident.wounds.write')
  if (!r) throw new ForbiddenError('resident.wounds.write')
  return { ctx, r }
}

const fail = (error: string, field?: string) => ({ ok: false as const, error, field })

/** "2026-10-21T14:30" als Stationszeit. */
function parseLocal(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  return Number.isNaN(d.getTime()) ? null : d
}

const pick = (v: string, list: readonly string[]) => (v && list.includes(v) ? v : null)

export async function createWoundAction(residentId: string, form: FormData): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const { ctx, r } = await load(residentId)
    const bodySite = fd(form, 'bodySite').slice(0, 120)
    if (!bodySite) return fail('care.wounds.errors.siteRequired', 'bodySite')
    const kind = pick(fd(form, 'kind'), WOUND_KINDS)
    if (!kind) return fail('care.wounds.errors.kindRequired', 'kind')
    const start = fd(form, 'startedAt') ? parseDateKey(fd(form, 'startedAt')) : new Date()
    if (Number.isNaN(start.getTime()) || start > addDays(startOfDay(), 1)) return fail('care.wounds.errors.dateInvalid', 'startedAt')
    const data = {
      residentId: r.id, bodySite, kind, classification: fd(form, 'classification').slice(0, 120) || null,
      origin: pick(fd(form, 'origin'), WOUND_ORIGINS), startedAt: start, createdById: ctx.user.id,
    }
    const w = await db.wound.create({ data })
    await audit(ctx, { action: 'wound.create', entityType: 'Wound', entityId: w.id, after: data, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'wound.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { woundId: w.id, step: 'created' } })
    refresh()
    return { ok: true, data: { id: w.id }, message: 'care.wounds.created' }
  })
}

/** Offene Verbandwechsel-Erinnerungen einer Wunde (Aufgaben mit sourceId wound:<id>:<datum>). */
const reminderWhere = (woundId: string) => ({ source: 'event' as const, sourceId: { startsWith: `wound:${woundId}:` }, status: { in: [...OPEN_STATUSES] } })

async function reminder(ctx: Ctx, r: { id: string; unitId: string }, woundId: string, site: string, at: Date) {
  const now = new Date()
  // Mit der Beurteilung gilt der heute fällige Verbandwechsel als erledigt; ältere künftige Erinnerungen entfallen.
  await db.task.updateMany({ where: { ...reminderWhere(woundId), dueAt: { lt: addDays(startOfDay(now), 1) } }, data: { status: 'done', completedById: ctx.user.id, completedAt: now } })
  await db.task.deleteMany({ where: { ...reminderWhere(woundId), status: { in: ['planned', 'ready'] }, dueAt: { gte: addDays(startOfDay(now), 1) } } })
  await db.task.createMany({
    data: [{
      orgId: ctx.org.id, unitId: r.unitId, residentId: r.id, title: ctx.t('care.wounds.changeTask', { site }), category: 'Behandlungspflege',
      dueAt: at, durationMin: 15, priority: 'important', source: 'event', sourceId: `wound:${woundId}:${dateKey(at)}`, createdById: ctx.user.id,
    }],
    skipDuplicates: true,
  })
  await emit({ orgId: ctx.org.id, type: 'task.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { source: 'wound', woundId } })
}

export async function saveWoundEntryAction(residentId: string, woundId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const w = await db.wound.findFirst({ where: { id: woundId, residentId: r.id } })
    if (!w) return fail('common.notFound')
    if (w.status === 'closed') return fail('care.wounds.errors.closed')

    const at = fd(form, 'at') ? parseLocal(fd(form, 'at')) : new Date()
    if (!at || at > new Date(Date.now() + 5 * 60_000)) return fail('care.wounds.errors.dateInvalid', 'at')
    const size: Record<'lengthMm' | 'widthMm' | 'depthMm', number | null> = { lengthMm: null, widthMm: null, depthMm: null }
    for (const [k, f] of [['lengthMm', 'length'], ['widthMm', 'width'], ['depthMm', 'depth']] as const) {
      const v = fdNum(form, f)
      if (v != null && (Number.isNaN(v) || v < 0 || v > 1000)) return fail('care.wounds.errors.sizeInvalid', f)
      size[k] = v
    }
    const pain = fdNum(form, 'pain')
    if (pain != null && (Number.isNaN(pain) || pain < 0 || pain > 10)) return fail('care.wounds.errors.painInvalid', 'pain')
    let nextChange: Date | null = null
    if (fd(form, 'nextChange')) {
      nextChange = parseLocal(fd(form, 'nextChange'))
      if (!nextChange || nextChange < at) return fail('care.wounds.errors.dateInvalid', 'nextChange')
    }
    const data = {
      ...size, pain: pain == null ? null : Math.round(pain),
      exudate: pick(fd(form, 'exudate'), EXUDATE), tissue: pick(fd(form, 'tissue'), TISSUE), edge: pick(fd(form, 'edge'), EDGE),
      description: fd(form, 'description').slice(0, 4000) || null, treatment: fd(form, 'treatment').slice(0, 2000) || null,
      material: fd(form, 'material').slice(0, 300) || null, nextChange,
    }
    const files = form.getAll('photos').filter((f): f is File => typeof f === 'object' && f != null && 'size' in f && (f as File).size > 0).slice(0, 6)
    const hasContent = Object.values(data).some((v) => v != null) || files.length > 0
    if (!hasContent) return fail('care.wounds.errors.empty')

    // Fotos: nur in der kontrollierten Ablage (PRD §15). Fehler beim Upload verhindern den Eintrag nicht.
    const photoIds: string[] = []
    let photoError: string | null = null
    for (const file of files) {
      try {
        photoIds.push((await saveUpload(ctx, file, 'wound', true)).id)
      } catch (e) {
        photoError = e instanceof UploadError ? e.message : 'other'
        if (photoError === 'storage_not_configured') break
      }
    }

    const entry = await db.woundAssessment.create({ data: { woundId: w.id, at, ...data, photoIds, authorId: ctx.user.id } })
    if (nextChange && nextChange > new Date()) await reminder(ctx, r, w.id, w.bodySite, nextChange)
    await audit(ctx, { action: 'wound.assess', entityType: 'WoundAssessment', entityId: entry.id, after: { ...data, photoIds, woundId: w.id, at }, context: { residentId: r.id, woundId: w.id } })
    await emit({ orgId: ctx.org.id, type: 'wound.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { woundId: w.id, step: 'assessed' } })
    invalidateTaskGeneration(r.unitId)
    refresh()
    if (photoError === 'storage_not_configured') return { ok: true, message: 'care.wounds.entrySavedNoPhoto' }
    if (photoError) {
      const reason = ctx.t('care.wounds.photoErrors.' + (['too_large', 'type', 'empty'].includes(photoError) ? photoError : 'other'))
      return { ok: true, message: ctx.t('care.wounds.entrySavedPhotoError', { reason }) }
    }
    return { ok: true, message: 'care.wounds.entrySaved' }
  })
}

export async function setWoundStatusAction(residentId: string, woundId: string, status: 'open' | 'healing' | 'closed'): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    if (!['open', 'healing', 'closed'].includes(status)) return fail('common.genericError')
    const w = await db.wound.findFirst({ where: { id: woundId, residentId: r.id } })
    if (!w) return fail('common.notFound')
    const now = new Date()
    const data = { status, closedAt: status === 'closed' ? now : null }
    await db.wound.update({ where: { id: w.id }, data })
    if (status === 'closed') await db.task.deleteMany({ where: { ...reminderWhere(w.id), status: { in: ['planned', 'ready'] }, dueAt: { gte: now } } })
    await audit(ctx, { action: 'wound.status', entityType: 'Wound', entityId: w.id, before: { status: w.status, closedAt: w.closedAt }, after: data, context: { residentId: r.id, woundId: w.id } })
    await emit({ orgId: ctx.org.id, type: 'wound.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { woundId: w.id, step: status } })
    invalidateTaskGeneration(r.unitId)
    refresh()
    return { ok: true, message: status === 'closed' ? 'care.wounds.closedToast' : 'care.wounds.statusChanged' }
  })
}
