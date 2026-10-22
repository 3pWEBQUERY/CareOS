'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { ForbiddenError, getCtx, residentInScope } from '@/lib/context'
import { fd, fdNum, run, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { MEALS, PORTIONS, type Meal } from '@/lib/care'
import { FLUID_KINDS, FLUID_LIMITS, type FluidKind } from '@/lib/fluid-balance'

async function load(residentId: string) {
  const ctx = await getCtx()
  const r = await residentInScope(ctx, residentId, 'resident.nutrition.write')
  if (!r) throw new ForbiddenError('resident.nutrition.write')
  return { ctx, r }
}

const fail = (error: string, field?: string) => ({ ok: false as const, error, field })

export async function saveProfileAction(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const target = fdNum(form, 'fluidTargetMl')
    if (target != null && (Number.isNaN(target) || target < 500 || target > 4000)) return fail('care.nutrition.errors.target', 'fluidTargetMl')
    const data = {
      dietForm: fd(form, 'dietForm').slice(0, 200) || null,
      texture: fd(form, 'texture').slice(0, 120) || null,
      intolerances: fd(form, 'intolerances').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20),
      supplements: fd(form, 'supplements').slice(0, 500) || null,
      swallowing: fd(form, 'swallowing').slice(0, 500) || null,
      fluidTargetMl: target == null ? null : Math.round(target),
      notes: fd(form, 'notes').slice(0, 2000) || null,
    }
    const before = await db.nutritionProfile.findUnique({ where: { residentId: r.id } })
    await db.nutritionProfile.upsert({ where: { residentId: r.id }, create: { residentId: r.id, ...data }, update: data })
    await audit(ctx, {
      action: 'nutrition.profile', entityType: 'NutritionProfile', entityId: r.id,
      before: before ? { dietForm: before.dietForm, texture: before.texture, intolerances: before.intolerances, supplements: before.supplements, swallowing: before.swallowing, fluidTargetMl: before.fluidTargetMl, notes: before.notes } : null,
      after: data, context: { residentId: r.id },
    })
    await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind: 'profile' } })
    refresh()
    return { ok: true, message: 'care.nutrition.profileSaved' }
  })
}

export async function addDrinkAction(residentId: string, ml: number, item: string): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const { ctx, r } = await load(residentId)
    const amountMl = Math.round(Number(ml))
    if (!Number.isFinite(amountMl) || amountMl < 10 || amountMl > 2000) return fail('care.nutrition.errors.amount', 'ml')
    const log = await db.intakeLog.create({ data: { residentId: r.id, kind: 'drink', amountMl, item: item.trim().slice(0, 120) || null, authorId: ctx.user.id } })
    await audit(ctx, { action: 'nutrition.intake', entityType: 'IntakeLog', entityId: log.id, after: { kind: 'drink', amountMl, item: log.item }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind: 'drink', amountMl } })
    refresh()
    return { ok: true, data: { id: log.id } }
  })
}

export async function addMealAction(residentId: string, meal: string, portion: number): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const { ctx, r } = await load(residentId)
    if (!MEALS.includes(meal as Meal)) return fail('care.nutrition.errors.meal')
    if (!PORTIONS.includes(portion as (typeof PORTIONS)[number])) return fail('care.nutrition.errors.portion')
    // Neuer Eintrag statt Überschreiben: der letzte Eintrag des Tages gilt, die Historie bleibt erhalten.
    const item = ctx.t('care.nutrition.mealNames.' + meal)
    const log = await db.intakeLog.create({ data: { residentId: r.id, kind: 'meal', item, portion, authorId: ctx.user.id } })
    await audit(ctx, { action: 'nutrition.intake', entityType: 'IntakeLog', entityId: log.id, after: { kind: 'meal', meal, item, portion }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind: 'meal', meal, portion } })
    refresh()
    return { ok: true, data: { id: log.id } }
  })
}

/** Rückgängig nur für eigene Einträge der letzten 10 Minuten (Fehlklick), protokolliert. */
export async function undoIntakeAction(residentId: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await load(residentId)
    const log = await db.intakeLog.findFirst({ where: { id, residentId: r.id, authorId: ctx.user.id, at: { gte: new Date(Date.now() - 10 * 60_000) } } })
    if (!log) return fail('care.nutrition.errors.undo')
    await db.intakeLog.delete({ where: { id: log.id } })
    await audit(ctx, { action: 'nutrition.intake.undo', entityType: 'IntakeLog', entityId: log.id, before: { kind: log.kind, amountMl: log.amountMl, item: log.item, portion: log.portion, at: log.at }, after: null, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind: 'undo' } })
    refresh()
    return { ok: true, message: 'care.nutrition.removed' }
  })
}

/** Flüssigkeitsbilanz (PRD §14): Einfuhr über Infusion/Sonde und Ausfuhr (Urin, Drainage, Erbrechen, sonstige). */
export async function addFluidAction(residentId: string, kind: string, ml: number, note: string): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const { ctx, r } = await load(residentId)
    if (!FLUID_KINDS.includes(kind as FluidKind)) return fail('care.fluid.errors.kind', 'kind')
    const amountMl = Math.round(Number(ml))
    if (!Number.isFinite(amountMl) || amountMl < FLUID_LIMITS.min || amountMl > FLUID_LIMITS.max) return fail('care.fluid.errors.amount', 'ml')
    const item = note.trim().slice(0, 120) || null
    const log = await db.intakeLog.create({ data: { residentId: r.id, kind, amountMl, item, authorId: ctx.user.id } })
    await audit(ctx, { action: 'nutrition.fluid', entityType: 'IntakeLog', entityId: log.id, after: { kind, amountMl, item }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'nutrition.recorded', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { kind, amountMl } })
    refresh()
    return { ok: true, data: { id: log.id } }
  })
}
