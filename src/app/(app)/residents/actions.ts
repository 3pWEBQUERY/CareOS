'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { assertCan, getCtx } from '@/lib/context'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { MASTER_FIELDS, parseMaster } from './_lib/master'
import { actionResident } from './_lib/resident'
import { snapshot, threeWay } from '@/lib/merge-check'
import { hm, fmtDayMonth, sameDay } from '@/lib/time'

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
      data: { ...p.data, orgId: ctx.org.id, unitId: unit.id, status: 'active', nutrition: { create: {} }, episodes: { create: { start: new Date(), reason: ctx.t('residents.history.admitted'), kind: 'stay', unitId: unit.id, createdById: ctx.user.id } } },
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

const FIELDS = MASTER_FIELDS

/** Stammdaten bearbeiten (inkl. Status und Zimmerwechsel), mit vollständigem Vorher/Nachher im Audit. */
export async function updateResident(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.edit')
    const p = parseMaster(form)
    if (!p.ok) return p
    const x = extra.parse({ status: fd(form, 'status') || r.status, importantNotes: fd(form, 'importantNotes'), insuranceNo: fd(form, 'insuranceNo'), primaryNurseId: fd(form, 'primaryNurseId') })
    // Abwesenheit und Rückkehr nur über «Aufenthalt» (Pflegeepisode mit Grund, Aufgaben pausieren; PRD §43)
    if (x.status !== r.status && (x.status === 'absent' || r.status === 'absent')) return { ok: false, error: 'residents.adt.errors.useStay', field: 'status' }
    if (p.data.roomId && p.data.roomId !== r.roomId && !(await roomFree(p.data.roomId, r.unitId, r.id))) return { ok: false, error: 'residents.form.errors.roomTaken', field: 'roomId' }
    if (x.primaryNurseId && !(await db.user.findFirst({ where: { id: x.primaryNurseId, orgId: ctx.org.id }, select: { id: true } }))) return { ok: false, error: 'common.notFound', field: 'primaryNurseId' }
    const mine: Record<string, unknown> = { ...p.data, status: x.status, importantNotes: x.importantNotes || null, insuranceNo: x.insuranceNo || null, primaryNurseId: x.primaryNurseId || null }
    // Konflikterkennung (PRD §32): zwischenzeitliche Änderungen anderer Personen nicht überschreiben.
    // Nur selbst geänderte Felder übernehmen; dasselbe Feld unterschiedlich geändert → Hinweis statt Speichern.
    let base: Record<string, unknown> | null = null
    try { base = fd(form, 'base') ? JSON.parse(fd(form, 'base')) : null } catch { base = null }
    let fields: Record<string, unknown> = mine
    if (base) {
      const tw = threeWay(base, snapshot(r as unknown as Record<string, unknown>, FIELDS), snapshot(mine, FIELDS), FIELDS)
      if (tw.conflicts.length) {
        const last = await db.auditLog.findFirst({ where: { entityType: 'Resident', entityId: r.id, action: 'resident.update', userId: { not: ctx.user.id } }, orderBy: { at: 'desc' }, select: { userId: true, at: true } })
        const u = last?.userId ? await db.user.findFirst({ where: { id: last.userId, orgId: ctx.org.id }, select: { firstName: true, lastName: true } }) : null
        const now = new Date()
        refresh()
        return {
          ok: false, field: tw.conflicts[0] === 'birthDate' ? 'birthDate' : tw.conflicts[0],
          error: ctx.t('residents.conflict.master', {
            by: u ? `${u.firstName.charAt(0)}. ${u.lastName}` : '–',
            at: last ? (sameDay(last.at, now) ? hm(last.at) : `${fmtDayMonth(last.at, ctx.locale)} ${hm(last.at)}`) : '–',
            fields: tw.conflicts.map((k) => {
              // Aktuellen Wert mitnennen (kurz), damit die Entscheidung ohne Suchen möglich ist
              const cur = (r as Record<string, unknown>)[k]
              const v = Array.isArray(cur) ? cur.join(', ') : cur instanceof Date ? cur.toLocaleDateString(ctx.locale) : cur == null || cur === '' ? '–' : ['roomId', 'primaryNurseId'].includes(k) ? null : String(cur)
              return ctx.t('residents.conflict.fields.' + k) + (v ? ` («${v.length > 60 ? v.slice(0, 59) + '…' : v}»)` : '')
            }).join(', '),
          }),
        }
      }
      fields = Object.fromEntries(FIELDS.map((k) => [k, tw.mineChanged.includes(k) ? mine[k] : (r as Record<string, unknown>)[k]]))
    }
    const status = fields.status as typeof x.status
    const leaving = status === 'discharged' || status === 'deceased'
    const next = {
      ...(fields as typeof mine & typeof p.data),
      status,
      roomId: leaving ? null : (fields.roomId as string | null),
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
    // Zwei gleichzeitige Speichervorgänge: nur der erste gewinnt, der zweite erhält den Konflikthinweis beim nächsten Versuch
    const res = await db.resident.updateMany({ where: { id: r.id, updatedAt: r.updatedAt }, data: next })
    if (res.count !== 1) { refresh(); return { ok: false, error: 'residents.conflict.retry' } }
    // Austritt schliesst den laufenden Aufenthalt (Pflegeepisode)
    if (leaving && next.dischargedAt) await db.careEpisode.updateMany({ where: { residentId: r.id, end: null }, data: { end: next.dischargedAt } })
    await audit(ctx, { action: 'resident.update', entityType: 'Resident', entityId: r.id, before, after, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { fields: Object.keys(after) } })
    if ('status' in after) invalidateTaskGeneration(r.unitId)
    refresh()
  })
}
