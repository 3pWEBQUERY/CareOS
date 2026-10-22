'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { assertCan, getCtx, residentInScope, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { aiDraft, aiFeedback, AiUnavailable } from '@/lib/ai'
import { lastShiftEnd, shiftTypes } from '@/lib/shift'
import { shiftName } from '@/lib/shift-name'
import { dbDate, parseDateKey, shiftBounds } from '@/lib/time'
import { collectHandover, handoverText } from './collect'
import { ackSettings } from '@/lib/acks'

const err = (error: string, field?: string): ActionResult => ({ ok: false, error, field })

/** Schicht aus Code + Startdatum; liefert Bereich, Grenzen und (optional angelegte) Übergabe. */
async function target(ctx: Ctx, form: FormData, create: boolean) {
  const unit = ctx.unit
  if (!unit) throw new Error('no_unit')
  const code = fd(form, 'shiftCode')
  const key = fd(form, 'date')
  const def = (await shiftTypes(ctx.org.id)).find((s) => s.code === code)
  if (!def || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('bad_shift')
  const day = parseDateKey(key)
  const bounds = shiftBounds(def, day)
  const where = { unitId_shiftCode_date: { unitId: unit.id, shiftCode: code, date: dbDate(day) } }
  const handover = create
    ? await db.handover.upsert({ where, update: {}, create: { unitId: unit.id, shiftCode: code, date: dbDate(day) } })
    : await db.handover.findUnique({ where })
  return { unit, def, day, bounds, handover }
}

/** Manuelle Ergänzung pro Person: weiter beobachten, noch offen, wichtig (Kenntnisnahme erforderlich). */
export async function saveEntryAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'handover.write', ctx.unit ? { unitId: ctx.unit.id, locationId: ctx.unit.locationId } : undefined)
    const r = await residentInScope(ctx, fd(form, 'residentId'))
    if (!r || r.unitId !== ctx.unit?.id) return err('common.notFound')
    const { handover } = await target(ctx, form, true)
    if (!handover) return err('common.genericError')
    if (handover.submittedAt) return err('tasks.handover.errors.submitted')
    const watch = fd(form, 'watch') || null
    const open = fd(form, 'open') || null
    const important = fdBool(form, 'important')
    if (important && !watch && !open) return err('tasks.handover.errors.importantEmpty', 'watch')
    const before = await db.handoverEntry.findUnique({ where: { handoverId_residentId: { handoverId: handover.id, residentId: r.id } } })
    const after = await db.handoverEntry.upsert({
      where: { handoverId_residentId: { handoverId: handover.id, residentId: r.id } },
      update: { watch, open, important, authorId: ctx.user.id },
      create: { handoverId: handover.id, residentId: r.id, watch, open, important, authorId: ctx.user.id },
    })
    await audit(ctx, { action: 'handover.entry.save', entityType: 'HandoverEntry', entityId: after.id, before, after, context: { residentId: r.id, handoverId: handover.id } })
    await emit({ orgId: ctx.org.id, type: 'handover.updated', unitId: handover.unitId, residentId: r.id, actorId: ctx.user.id, payload: { handoverId: handover.id } })
    refresh()
    return { ok: true, message: ctx.t('tasks.handover.toast.entrySaved') }
  }) as Promise<ActionResult>
}

/** Übergabe abschliessen: setzt submittedAt; danach sind Ergänzungen gesperrt und die Kenntnisnahme beginnt. */
export async function submitHandoverAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'handover.write', ctx.unit ? { unitId: ctx.unit.id, locationId: ctx.unit.locationId } : undefined)
    const { handover, bounds } = await target(ctx, form, true)
    if (!handover) return err('common.genericError')
    if (handover.submittedAt) return err('tasks.handover.errors.submitted')
    if (bounds.start > new Date()) return err('tasks.handover.errors.notStarted')
    const note = fd(form, 'note') || handover.note
    const after = await db.handover.update({ where: { id: handover.id }, data: { submittedAt: new Date(), authorId: ctx.user.id, note } })
    await audit(ctx, { action: 'handover.submit', entityType: 'Handover', entityId: handover.id, before: handover, after })
    await emit({ orgId: ctx.org.id, type: 'handover.updated', unitId: handover.unitId, actorId: ctx.user.id, payload: { handoverId: handover.id, submitted: true } })
    refresh()
    return { ok: true, message: ctx.t('tasks.handover.toast.submitted') }
  }) as Promise<ActionResult>
}

/**
 * Kenntnisnahme (PRD §11.4). residentId gesetzt → eine Person (version = residentId).
 * residentIds (Komma-Liste) → «Meine übernehmen»: die zugeteilten Personen (PRD §71), ohne Gesamtbestätigung.
 * Leer → alle: nur möglich, wenn alle wichtigen Einträge einzeln übernommen sind; setzt zusätzlich die Gesamtbestätigung (version '').
 */
export async function acknowledgeAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'handover.read', ctx.unit ? { unitId: ctx.unit.id, locationId: ctx.unit.locationId } : undefined)
    const { handover, unit } = await target(ctx, form, true)
    if (!handover) return err('common.genericError')
    const residentId = fd(form, 'residentId')
    const subset = residentId ? [] : [...new Set(fd(form, 'residentIds').split(',').filter(Boolean))]
    const mine = await db.acknowledgement.findMany({ where: { userId: ctx.user.id, subjectType: 'handover', subjectId: handover.id } })
    const has = new Set(mine.map((a) => a.version))
    let created: string[] = []
    let importantConfirmed: string[] = []
    if (residentId) {
      const r = await residentInScope(ctx, residentId)
      if (!r || r.unitId !== unit.id) return err('common.notFound')
      if (!has.has(r.id)) created = [r.id]
    } else if (subset.length) {
      const rs = await db.resident.findMany({ where: { id: { in: subset }, unitId: unit.id, orgId: ctx.org.id }, select: { id: true } })
      if (rs.length !== subset.length) return err('common.notFound')
      if (ackSettings(ctx.org.settings).handoverImportantRequiresAck) {
        const confirmed = new Set(fd(form, 'confirmed').split(',').filter(Boolean))
        const entries = await db.handoverEntry.findMany({ where: { handoverId: handover.id, important: true, residentId: { in: subset } } })
        if (entries.some((e) => !has.has(e.residentId) && !confirmed.has(e.residentId))) return err('tasks.handover.errors.importantFirst')
        importantConfirmed = entries.filter((e) => !has.has(e.residentId)).map((e) => e.residentId)
      }
      created = subset.filter((id) => !has.has(id))
    } else {
      if (ackSettings(ctx.org.settings).handoverImportantRequiresAck) {
        // Wichtige Einträge: einzeln übernommen oder im Bestätigungsdialog ausdrücklich je Eintrag bestätigt (PRD §11.4)
        const confirmed = new Set(fd(form, 'confirmed').split(',').filter(Boolean))
        const entries = await db.handoverEntry.findMany({ where: { handoverId: handover.id, important: true } })
        const missing = entries.filter((e) => !has.has(e.residentId) && !confirmed.has(e.residentId))
        if (missing.length) return err('tasks.handover.errors.importantFirst')
        importantConfirmed = entries.filter((e) => !has.has(e.residentId)).map((e) => e.residentId)
      }
      const residents = await db.resident.findMany({ where: { unitId: unit.id, orgId: ctx.org.id, status: { in: ['active', 'absent'] } }, select: { id: true } })
      created = [...residents.map((r) => r.id).filter((id) => !has.has(id)), ...(has.has('') ? [] : [''])]
    }
    if (!created.length) return { ok: true }
    await db.acknowledgement.createMany({ data: created.map((version) => ({ userId: ctx.user.id, subjectType: 'handover', subjectId: handover.id, version })), skipDuplicates: true })
    await audit(ctx, { action: 'handover.acknowledge', entityType: 'Handover', entityId: handover.id, after: { versions: created }, context: residentId ? { residentId } : subset.length ? { mine: true, importantConfirmed } : { all: true, importantConfirmed } })
    await emit({ orgId: ctx.org.id, type: 'handover.acknowledged', unitId: unit.id, residentId: residentId || null, actorId: ctx.user.id, payload: { handoverId: handover.id } })
    refresh()
    return { ok: true, message: ctx.t(residentId ? 'tasks.handover.toast.acked' : subset.length ? 'home.ho.toastMine' : 'tasks.handover.toast.ackedAll', { n: created.length }) }
  }) as Promise<ActionResult>
}

/** CareOS AI Handover Assistant (PRD §23.1): Entwurf einer Zusammenfassung, nie automatisch gespeichert. */
export async function aiSummaryAction(form: FormData): Promise<ActionResult<{ id: string; text: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'handover.read', ctx.unit ? { unitId: ctx.unit.id, locationId: ctx.unit.locationId } : undefined)
    const { handover, bounds, unit, def } = await target(ctx, form, false)
    let from = bounds.start
    let to = bounds.end
    if (fd(form, 'since') === '1') {
      from = (await lastShiftEnd(ctx.user.id, ctx.sessionId)).at
      to = new Date()
    }
    const blocks = await collectHandover(ctx, unit.id, from, to, handover?.id ?? null)
    const input = handoverText(blocks, ctx.t)
    if (!input.trim()) return { ok: false, error: 'tasks.handover.ai.empty' }
    try {
      const res = await aiDraft(ctx, 'handover', ctx.t('tasks.handover.ai.instruction', { shift: shiftName(ctx.t, def) }), input, 1500)
      return { ok: true, data: res }
    } catch (e) {
      if (e instanceof AiUnavailable) return { ok: false, error: 'common.ai.unavailable' }
      throw e
    }
  })
}

/** KI-Entwurf übernehmen (als Hinweis der Übergabe) oder verwerfen. */
export async function aiDecisionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const id = fd(form, 'aiId')
    const accept = fd(form, 'accept') === '1'
    await aiFeedback(ctx, id, accept)
    if (!accept) return { ok: true }
    assertCan(ctx, 'handover.write', ctx.unit ? { unitId: ctx.unit.id, locationId: ctx.unit.locationId } : undefined)
    const { handover } = await target(ctx, form, true)
    if (!handover) return err('common.genericError')
    if (handover.submittedAt) return err('tasks.handover.errors.submitted')
    const text = fd(form, 'text')
    if (!text) return err('tasks.handover.ai.empty')
    const after = await db.handover.update({ where: { id: handover.id }, data: { note: text } })
    await audit(ctx, { action: 'handover.note.ai', entityType: 'Handover', entityId: handover.id, before: { note: handover.note }, after: { note: after.note }, context: { aiInteractionId: id } })
    await emit({ orgId: ctx.org.id, type: 'handover.updated', unitId: handover.unitId, actorId: ctx.user.id, payload: { handoverId: handover.id } })
    refresh()
    return { ok: true, message: ctx.t('tasks.handover.toast.noteSaved') }
  }) as Promise<ActionResult>
}
