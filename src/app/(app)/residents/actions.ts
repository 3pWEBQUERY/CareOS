'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { assertCan, getCtx } from '@/lib/context'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { parseMaster } from './_lib/master'
import { actionResident } from './_lib/resident'

async function roomFree(roomId: string, unitId: string, exceptResidentId?: string) {
  const room = await db.room.findFirst({ where: { id: roomId, unitId }, include: { residents: { where: { status: { in: ['active', 'absent'] }, id: exceptResidentId ? { not: exceptResidentId } : undefined }, select: { id: true } } } })
  return !!room && room.residents.length < room.beds
}

/** Aufnahme (PRD §8): neue Person im aktuell gewählten Bereich, mit leerem Ernährungsprofil. */
export async function admitResident(form: FormData): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    const unit = ctx.unit
    if (!unit) return { ok: false, error: 'residents.form.errors.noUnit' }
    assertCan(ctx, 'resident.create', { unitId: unit.id, locationId: unit.locationId })
    const p = parseMaster(form)
    if (!p.ok) return p
    if (p.data.roomId && !(await roomFree(p.data.roomId, unit.id))) return { ok: false, error: 'residents.form.errors.roomTaken', field: 'roomId' }
    const r = await db.resident.create({
      data: { ...p.data, orgId: ctx.org.id, unitId: unit.id, status: 'active', nutrition: { create: {} } },
    })
    await audit(ctx, { action: 'resident.create', entityType: 'Resident', entityId: r.id, after: { ...p.data, unitId: unit.id }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: unit.id, residentId: r.id, actorId: ctx.user.id, payload: { created: true } })
    invalidateTaskGeneration(unit.id)
    refresh()
    return { ok: true, data: { id: r.id } }
  })
}

const extra = z.object({
  status: z.enum(['active', 'absent', 'discharged', 'deceased']),
  importantNotes: z.string().max(2000),
  insuranceNo: z.string().max(40),
  primaryNurseId: z.string().max(40),
})

const FIELDS = ['firstName', 'lastName', 'birthDate', 'sex', 'roomId', 'careLevel', 'physician', 'rea', 'allergies', 'risks', 'diet', 'mobility', 'status', 'importantNotes', 'insuranceNo', 'primaryNurseId'] as const

/** Stammdaten bearbeiten (inkl. Status und Zimmerwechsel), mit vollständigem Vorher/Nachher im Audit. */
export async function updateResident(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.edit')
    const p = parseMaster(form)
    if (!p.ok) return p
    const x = extra.parse({ status: fd(form, 'status') || r.status, importantNotes: fd(form, 'importantNotes'), insuranceNo: fd(form, 'insuranceNo'), primaryNurseId: fd(form, 'primaryNurseId') })
    if (p.data.roomId && p.data.roomId !== r.roomId && !(await roomFree(p.data.roomId, r.unitId, r.id))) return { ok: false, error: 'residents.form.errors.roomTaken', field: 'roomId' }
    if (x.primaryNurseId && !(await db.user.findFirst({ where: { id: x.primaryNurseId, orgId: ctx.org.id }, select: { id: true } }))) return { ok: false, error: 'common.notFound', field: 'primaryNurseId' }
    const leaving = x.status === 'discharged' || x.status === 'deceased'
    const next = {
      ...p.data,
      status: x.status,
      importantNotes: x.importantNotes || null,
      insuranceNo: x.insuranceNo || null,
      primaryNurseId: x.primaryNurseId || null,
      roomId: leaving ? null : p.data.roomId,
      dischargedAt: leaving ? (r.dischargedAt ?? new Date()) : null,
    }
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null))
    for (const k of [...FIELDS, 'dischargedAt'] as const) {
      const a = (r as Record<string, unknown>)[k]
      const b = (next as Record<string, unknown>)[k]
      if (norm(a) !== norm(b)) { before[k] = a ?? null; after[k] = b ?? null }
    }
    if (!Object.keys(after).length) return { ok: true, message: 'residents.history.noChange' }
    await db.resident.update({ where: { id: r.id }, data: next })
    await audit(ctx, { action: 'resident.update', entityType: 'Resident', entityId: r.id, before, after, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { fields: Object.keys(after) } })
    if ('status' in after) invalidateTaskGeneration(r.unitId)
    refresh()
  })
}
