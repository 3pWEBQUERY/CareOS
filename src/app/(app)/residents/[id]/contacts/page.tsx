import { db } from '@/lib/db'
import { pageResident, residentName } from '../../_lib/resident'
import { Contacts } from './Contacts'

export default async function ContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t } = ctx
  const contacts = await db.contact.findMany({ where: { residentId: r.id }, orderBy: [{ isEmergency: 'desc' }, { isLegalRep: 'desc' }, { name: 'asc' }] })
  return (
    <Contacts
      residentId={r.id}
      who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
      contacts={contacts.map((c) => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, email: c.email, isEmergency: c.isEmergency, isLegalRep: c.isLegalRep, notes: c.notes }))}
      canEdit={can('resident.edit')}
    />
  )
}
