'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { atTime, parseDateKey } from '@/lib/time'
import { actionResident } from '../../_lib/resident'


const schema = z.object({
  title: z.string().min(2, 'residents.appointments.errors.title').max(200),
  kind: z.enum(['physician', 'therapy', 'hospital', 'relatives', 'other']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'residents.appointments.errors.date'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'residents.appointments.errors.time'),
  place: z.string().max(200),
  notes: z.string().max(2000),
})

const parse = (form: FormData) => {
  const p = schema.parse({ title: fd(form, 'title'), kind: fd(form, 'kind') || 'other', date: fd(form, 'date'), time: fd(form, 'time') || '00:00', place: fd(form, 'place'), notes: fd(form, 'notes') })
  return { title: p.title, kind: p.kind, at: atTime(parseDateKey(p.date), p.time), place: p.place || null, notes: p.notes || null }
}
const snap = (a: { title: string; kind: string; at: Date; place: string | null; notes: string | null; done: boolean }) => ({ title: a.title, kind: a.kind, at: a.at, place: a.place, notes: a.notes, done: a.done })

export async function saveAppointment(residentId: string, appointmentId: string | null, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const data = parse(form)
    if (appointmentId) {
      const old = await db.appointment.findFirst({ where: { id: appointmentId, residentId: r.id } })
      if (!old) return { ok: false, error: 'common.notFound' }
      const a = await db.appointment.update({ where: { id: old.id }, data: { ...data, done: fdBool(form, 'done') } })
      await audit(ctx, { action: 'appointment.update', entityType: 'Appointment', entityId: a.id, before: snap(old), after: snap(a), context: { residentId: r.id } })
    } else {
      const a = await db.appointment.create({ data: { ...data, residentId: r.id, createdById: ctx.user.id } })
      await audit(ctx, { action: 'appointment.create', entityType: 'Appointment', entityId: a.id, after: snap(a), context: { residentId: r.id } })
    }
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { appointment: true } })
    refresh()
  })
}

export async function setAppointmentDone(residentId: string, appointmentId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.chart.write')
    const old = await db.appointment.findFirst({ where: { id: appointmentId, residentId: r.id } })
    if (!old) return { ok: false, error: 'common.notFound' }
    const a = await db.appointment.update({ where: { id: old.id }, data: { done } })
    await audit(ctx, { action: 'appointment.update', entityType: 'Appointment', entityId: a.id, before: { done: old.done }, after: { done: a.done }, context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { appointment: true } })
    refresh()
  })
}
