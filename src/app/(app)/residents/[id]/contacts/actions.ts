'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { emit } from '@/lib/events'
import { actionResident } from '../../_lib/resident'
import { revokeForContact } from '@/lib/portal/manage'

const schema = z.object({
  name: z.string().min(2, 'residents.contacts.errors.name').max(120),
  relation: z.string().min(1, 'residents.contacts.errors.relation').max(80),
  phone: z.string().max(40),
  email: z.union([z.literal(''), z.email('residents.contacts.errors.email')]),
  notes: z.string().max(1000),
})

const snap = (c: { name: string; relation: string; phone: string | null; email: string | null; isEmergency: boolean; isLegalRep: boolean; notes: string | null }) =>
  ({ name: c.name, relation: c.relation, phone: c.phone, email: c.email, isEmergency: c.isEmergency, isLegalRep: c.isLegalRep, notes: c.notes })

export async function saveContact(residentId: string, contactId: string | null, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.edit')
    const p = schema.parse({ name: fd(form, 'name'), relation: fd(form, 'relation'), phone: fd(form, 'phone'), email: fd(form, 'email'), notes: fd(form, 'notes') })
    const data = { name: p.name, relation: p.relation, phone: p.phone || null, email: p.email || null, notes: p.notes || null, isEmergency: fdBool(form, 'isEmergency'), isLegalRep: fdBool(form, 'isLegalRep') }
    if (contactId) {
      const old = await db.contact.findFirst({ where: { id: contactId, residentId: r.id } })
      if (!old) return { ok: false, error: 'common.notFound' }
      const c = await db.contact.update({ where: { id: old.id }, data })
      await audit(ctx, { action: 'contact.update', entityType: 'Contact', entityId: c.id, before: snap(old), after: snap(c), context: { residentId: r.id } })
    } else {
      const c = await db.contact.create({ data: { ...data, residentId: r.id } })
      await audit(ctx, { action: 'contact.create', entityType: 'Contact', entityId: c.id, after: snap(c), context: { residentId: r.id } })
    }
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { contacts: true } })
    refresh()
  })
}

export async function deleteContact(residentId: string, contactId: string): Promise<ActionResult> {
  return run(async () => {
    const { ctx, r } = await actionResident(residentId, 'resident.edit')
    const old = await db.contact.findFirst({ where: { id: contactId, residentId: r.id } })
    if (!old) return { ok: false, error: 'common.notFound' }
    // Portal-Zugänge dieser Person widerrufen (Einwilligung und Einladung bezogen sich auf sie)
    await revokeForContact(ctx, old.id)
    await db.contact.delete({ where: { id: old.id } })
    await audit(ctx, { action: 'contact.delete', entityType: 'Contact', entityId: old.id, before: snap(old), context: { residentId: r.id } })
    await emit({ orgId: ctx.org.id, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: ctx.user.id, payload: { contacts: true } })
    refresh()
  })
}
