'use server'

import { refresh } from 'next/cache'
import { getCtx, assertCan, residentInScope } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { AdtError, adtEvent, EventBody, type AdtEvent } from '@/lib/adt'
import { atTime, parseDateKey, startOfDay } from '@/lib/time'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { anonymiseResident } from '@/lib/retention'

/**
 * Manuelle Anonymisierung einer ausgetretenen oder verstorbenen Person (Löschkonzept, PRD §36).
 * Nur mit admin.org und ausdrücklicher Bestätigung. Das Audit enthält bewusst keine Personendaten.
 */
export async function anonymiseResidentAction(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.org')
    const r = await residentInScope(ctx, residentId)
    if (!r) return { ok: false, error: 'common.notFound' }
    if (r.status !== 'discharged' && r.status !== 'deceased') return { ok: false, error: 'residents.dataRights.errors.active' }
    if (!fdBool(form, 'confirm')) return { ok: false, error: 'residents.dataRights.errors.confirm', field: 'confirm' }
    const f = await anonymiseResident(r.id)
    await audit(ctx, {
      action: 'resident.anonymise', entityType: 'Resident', entityId: r.id,
      before: { status: r.status, dischargedAt: r.dischargedAt, anonymisedAt: r.anonymisedAt },
      after: { anonymised: !f.failed },
      context: { residentId: r.id, trigger: 'manual', filesDeleted: f.deleted, filesFailed: f.failed },
    })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { anonymised: true } })
    refresh()
    if (f.failed) return { ok: false, error: 'residents.dataRights.errors.files' }
    return { ok: true, message: 'residents.dataRights.done' }
  })
}

const ADT_REASONS = ['hospital', 'holiday', 'relatives', 'rehab', 'other'] as const
const localAt = (v: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v)
  return m ? atTime(parseDateKey(m[1]), m[2]) : null
}

/**
 * Abwesenheit, Rückkehr und Verlegung in der Akte (PRD §43, §40): gleiche Logik wie die ADT-Schnittstelle
 * (src/lib/adt.ts) – Pflegeepisode, Aufgaben pausieren/fortsetzen bzw. mitnehmen, Audit, Echtzeit.
 */
export async function adtAction(residentId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await residentInScope(ctx, residentId)
    if (!r) return { ok: false, error: 'common.notFound' }
    assertCan(ctx, 'resident.edit', { unitId: r.unitId, locationId: r.unit.locationId })
    const event = fd(form, 'event')
    const at = localAt(fd(form, 'at'))
    if (!at) return { ok: false, error: 'residents.adt.errors.at', field: 'at' }
    if (at.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: 'residents.adt.errors.future', field: 'at' }
    const note = fd(form, 'note').slice(0, 160)
    let body: AdtEvent
    if (event === 'leave') {
      const key = fd(form, 'reason')
      if (!(ADT_REASONS as readonly string[]).includes(key)) return { ok: false, error: 'residents.adt.errors.reason', field: 'reason' }
      if (key === 'other' && !note) return { ok: false, error: 'residents.adt.errors.note', field: 'note' }
      const ret = fd(form, 'expectedReturn')
      if (ret && (!/^\d{4}-\d{2}-\d{2}$/.test(ret) || parseDateKey(ret) < startOfDay(at))) return { ok: false, error: 'residents.adt.errors.expectedReturn', field: 'expectedReturn' }
      const label = ctx.t('residents.adt.reasons.' + key)
      body = { event: 'leave', at: at.toISOString(), reason: key === 'other' ? note : note ? `${label}: ${note}` : label, ...(ret ? { expectedReturn: ret } : {}) }
    } else if (event === 'return') {
      body = { event: 'return', at: at.toISOString(), ...(fd(form, 'roomId') ? { roomId: fd(form, 'roomId') } : {}) }
    } else if (event === 'transfer') {
      const unitId = fd(form, 'unitId')
      const unit = ctx.units.find((u) => u.id === unitId)
      if (!unit) return { ok: false, error: 'residents.adt.errors.unit', field: 'unitId' }
      assertCan(ctx, 'resident.edit', { unitId: unit.id, locationId: unit.locationId })
      if (unit.id === r.unitId && (fd(form, 'roomId') || null) === r.roomId) return { ok: false, error: 'residents.adt.errors.noChange', field: 'unitId' }
      body = { event: 'transfer', unitId: unit.id, at: at.toISOString(), ...(fd(form, 'roomId') ? { roomId: fd(form, 'roomId') } : {}), ...(note ? { reason: note } : {}) }
    } else return { ok: false, error: 'common.genericError' }
    const parsed = EventBody.safeParse(body)
    if (!parsed.success) return { ok: false, error: 'common.genericError' }
    try {
      await adtEvent({ orgId: ctx.org.id, actorId: ctx.user.id, audit: (e) => audit(ctx, e), via: 'app' }, r.id, parsed.data)
    } catch (e) {
      if (e instanceof AdtError) {
        const map: Record<string, [string, string?]> = { room_occupied: ['residents.form.errors.roomTaken', 'roomId'], conflict: ['residents.conflict.retry'], validation_failed: ['residents.adt.errors.invalid'], not_current: ['residents.adt.errors.notCurrent'] }
        const [error, field] = map[e.code] ?? ['common.genericError']
        refresh()
        return { ok: false, error, field }
      }
      throw e
    }
    refresh()
    return { ok: true, message: 'residents.adt.toast.' + event }
  })
}
