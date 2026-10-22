'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { assertCan, getCtx, residentInScope } from '@/lib/context'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { settleNotifications } from '@/lib/notify'
import { shiftFromKey } from '@/lib/assignment'
import { cleanPairs, diffPairs } from '@/lib/assignment-plan'
import { dbDate, fmtNum, hm } from '@/lib/time'
import { abnormalKeys, LIVE, mergeLimits, VITALS } from '@/lib/vitals'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

const assignmentInput = z.object({
  shiftCode: z.string().min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pairs: z.array(z.object({ residentId: z.string().min(1).max(40), userId: z.string().min(1).max(40) })).max(2000),
})

/**
 * Bewohnerzuordnung einer Schicht speichern (PRD §7, §70): ersetzt die Zuteilung dieser Schicht im gewählten Bereich.
 * Zulässig für laufende, kommende und höchstens 12 Stunden zurückliegende Schichten (Nachtrag nach Dienstende).
 */
export async function saveAssignmentsAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const unit = ctx.unit
    if (!unit) return err('tasks.noUnit')
    assertCan(ctx, 'task.manage', { unitId: unit.id, locationId: unit.locationId })
    let raw: unknown
    try {
      raw = { shiftCode: fd(form, 'shiftCode'), date: fd(form, 'date'), pairs: JSON.parse(fd(form, 'pairs') || '[]') }
    } catch {
      return err('common.genericError')
    }
    const input = assignmentInput.parse(raw)
    const ref = await shiftFromKey(ctx.org.id, input.shiftCode, input.date)
    if (!ref) return err('home.assign.errors.shift')
    if (ref.end.getTime() < Date.now() - 12 * 3600_000) return err('home.assign.errors.past')

    const date = dbDate(ref.day)
    const [residents, staff, before] = await Promise.all([
      db.resident.findMany({ where: { orgId: ctx.org.id, unitId: unit.id, status: { in: ['active', 'absent'] } }, select: { id: true } }),
      db.user.findMany({ where: { orgId: ctx.org.id, active: true, id: { in: input.pairs.map((p) => p.userId) } }, select: { id: true } }),
      db.shiftAssignment.findMany({ where: { orgId: ctx.org.id, unitId: unit.id, shiftCode: ref.def.code, date }, select: { id: true, residentId: true, userId: true } }),
    ])
    const pairs = cleanPairs(input.pairs, residents.map((r) => r.id), staff.map((u) => u.id))
    if (pairs.length !== input.pairs.length) return err('home.assign.errors.invalid')
    const { added, removed } = diffPairs(before, pairs)
    if (!added.length && !removed.length) return { ok: true, message: ctx.t('home.assign.toast.unchanged') }

    await db.$transaction(async (tx) => {
      const gone = before.filter((b) => removed.some((r) => r.residentId === b.residentId && r.userId === b.userId)).map((b) => b.id)
      if (gone.length) await tx.shiftAssignment.deleteMany({ where: { id: { in: gone } } })
      if (added.length) {
        await tx.shiftAssignment.createMany({
          data: added.map((p) => ({ orgId: ctx.org.id, unitId: unit.id, shiftCode: ref.def.code, date, residentId: p.residentId, userId: p.userId, createdById: ctx.user.id })),
          skipDuplicates: true,
        })
      }
      await audit(ctx, {
        action: 'assignment.save', entityType: 'ShiftAssignment', entityId: `${unit.id}:${ref.def.code}:${ref.key}`,
        before: { pairs: before.map(({ residentId, userId }) => ({ residentId, userId })) },
        after: { pairs },
        context: { unitId: unit.id, shiftCode: ref.def.code, date: ref.key, added: added.length, removed: removed.length },
      }, tx)
    })
    const affected = [...new Set([...added, ...removed].map((p) => p.userId))]
    await emit({ orgId: ctx.org.id, type: 'assignment.updated', unitId: unit.id, actorId: ctx.user.id, payload: { shiftCode: ref.def.code, date: ref.key, users: affected } })
    refresh()
    return { ok: true, message: ctx.t('home.assign.toast.saved', { n: new Set(pairs.map((p) => p.residentId)).size }) }
  }) as Promise<ActionResult>
}

const reviewInput = z.object({
  vitalId: z.string().min(1).max(40),
  kind: z.enum(['seen', 'action']),
  note: z.string().max(500),
})

/**
 * Auffälligen Vitalwert als gesehen bzw. «Massnahme eingeleitet» markieren (PRD §14 ohne Alarmflut).
 * Nimmt den Wert aus «Kritisch» (Home) und aus dem Hinweis der Akte; der Wert selbst bleibt unverändert.
 * Die Massnahme wird zusätzlich als Verlaufseintrag dokumentiert (PRD §4.4 Document Once).
 */
export async function reviewVitalAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const input = reviewInput.parse({ vitalId: fd(form, 'vitalId'), kind: fd(form, 'kind'), note: fd(form, 'note') })
    const v = await db.vitalSign.findFirst({ where: { id: input.vitalId, ...LIVE } })
    if (!v) return err('common.notFound')
    const r = await residentInScope(ctx, v.residentId, 'resident.vitals.write')
    if (!r) return err('common.notAllowed')
    if (input.kind === 'action' && input.note.length < 3) return err('home.review.errors.note', 'note')
    if (v.reviewedAt) return { ok: true, message: ctx.t('home.review.toast.already') }
    const limits = mergeLimits(await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }), r.id)
    const ab = abnormalKeys(v, limits)
    if (!ab.length) return err('home.review.errors.normal')
    const now = new Date()
    const canChart = ctx.can('resident.chart.write', { unitId: r.unitId, locationId: r.unit.locationId })
    const values = ab.map((k) => `${ctx.t('common.vitals.' + k)} ${fmtNum(v[k] as number, VITALS[k].dec, ctx.locale)} ${VITALS[k].unit}`).join(', ')
    const done = await db.$transaction(async (tx) => {
      // Nur setzen, wenn noch niemand anders den Wert bearbeitet hat (zwei Geräte gleichzeitig)
      const upd = await tx.vitalSign.updateMany({
        where: { id: v.id, reviewedAt: null },
        data: { reviewedAt: now, reviewedById: ctx.user.id, reviewKind: input.kind, reviewNote: input.kind === 'action' ? input.note : null },
      })
      if (!upd.count) return false
      let observationId: string | null = null
      if (input.kind === 'action' && canChart) {
        const o = await tx.observation.create({
          data: {
            residentId: r.id, at: now, category: 'observation', authorId: ctx.user.id,
            text: ctx.t('home.review.noteText', { values, time: hm(v.at), note: input.note }),
            structured: { kind: 'vital-review', vitalId: v.id },
          },
        })
        observationId = o.id
      }
      await audit(ctx, {
        action: 'vitals.review', entityType: 'VitalSign', entityId: v.id,
        before: { reviewedAt: null }, after: { reviewedAt: now, reviewKind: input.kind, reviewNote: input.kind === 'action' ? input.note : null },
        context: { residentId: r.id, abnormal: ab, observationId },
      }, tx)
      return true
    })
    if (!done) return { ok: true, message: ctx.t('home.review.toast.already') }
    await emit({ orgId: ctx.org.id, type: 'vitals.reviewed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: v.id, kind: input.kind } })
    // Benachrichtigung «auffälliger Wert» bei allen Empfangenden erledigen, sofern kein späterer auffälliger Wert offen ist (PRD §25)
    const later = await db.vitalSign.findMany({ where: { residentId: r.id, at: { gt: v.at }, reviewedAt: null, ...LIVE } })
    if (!later.some((x) => abnormalKeys(x, limits).length)) await settleNotifications(ctx.org.id, `vitals:${r.id}`, now)
    if (input.kind === 'action' && canChart) await emit({ orgId: ctx.org.id, type: 'observation.created', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id })
    refresh()
    return { ok: true, message: ctx.t(input.kind === 'action' ? 'home.review.toast.action' : 'home.review.toast.seen') }
  }) as Promise<ActionResult>
}

/** Rückgängig für «gesehen» (nur eigene Markierung, nur ohne Massnahme, innerhalb von 10 Minuten). */
export async function undoReviewVitalAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const id = fd(form, 'vitalId')
    const v = await db.vitalSign.findFirst({ where: { id } })
    if (!v) return err('common.notFound')
    const r = await residentInScope(ctx, v.residentId, 'resident.vitals.write')
    if (!r) return err('common.notAllowed')
    if (v.reviewedById !== ctx.user.id || v.reviewKind !== 'seen' || !v.reviewedAt || Date.now() - v.reviewedAt.getTime() > 10 * 60_000) return err('home.review.errors.undo')
    await db.vitalSign.update({ where: { id: v.id }, data: { reviewedAt: null, reviewedById: null, reviewKind: null, reviewNote: null } })
    await audit(ctx, { action: 'vitals.review.undo', entityType: 'VitalSign', entityId: v.id, before: { reviewedAt: v.reviewedAt, reviewKind: v.reviewKind }, after: { reviewedAt: null }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'vitals.reviewed', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { vitalId: v.id, undo: true } })
    refresh()
    return { ok: true }
  }) as Promise<ActionResult>
}
