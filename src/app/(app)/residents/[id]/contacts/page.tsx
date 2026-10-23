import { db } from '@/lib/db'
import { pageResident, residentName, residentTitle } from '../../_lib/resident'
import { Contacts } from './Contacts'
import type { AccessRow } from './ContactPortal'
import { dateKey } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { accessState, normalizeGrants, portalSettings } from '@/lib/portal/policy'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'contacts')
}

export default async function ContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t } = ctx
  const contacts = await db.contact.findMany({ where: { residentId: r.id }, orderBy: [{ isEmergency: 'desc' }, { isLegalRep: 'desc' }, { name: 'asc' }] })
  // Angehörigenportal (PRD §60): Zugänge je Kontaktperson; sichtbar mit portal.manage oder portal.respond im Bereich
  const canManage = can('portal.manage')
  const showPortal = canManage || can('portal.respond')
  const rows = showPortal
    ? await db.portalAccess.findMany({ where: { orgId: ctx.org.id, residentId: r.id }, include: { account: { select: { lockedAt: true, lastLoginAt: true } } }, orderBy: { createdAt: 'desc' } })
    : []
  const accesses: Record<string, AccessRow[]> = {}
  for (const a of rows) {
    if (!a.contactId) continue
    ;(accesses[a.contactId] ??= []).push({
      id: a.id, role: a.role, state: accessState(a, a.account), grants: normalizeGrants(a.grants), consentBy: a.consentBy, consentName: a.consentName,
      consentAt: a.consentAt.toISOString(), inviteEmail: a.inviteEmail, inviteExpiresAt: a.inviteExpiresAt?.toISOString() ?? null,
      lastLoginAt: a.account?.lastLoginAt?.toISOString() ?? null, revokedAt: a.revokedAt?.toISOString() ?? null,
    })
  }
  const legalRep = contacts.find((c) => c.isLegalRep)?.name ?? null
  return (
    <Contacts
      residentId={r.id}
      who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
      contacts={contacts.map((c) => ({ id: c.id, name: c.name, relation: c.relation, phone: c.phone, email: c.email, isEmergency: c.isEmergency, isLegalRep: c.isLegalRep, notes: c.notes }))}
      canEdit={can('resident.edit')}
      portal={showPortal ? { canManage, moduleOn: portalEnabled(ctx.org), defaults: portalSettings(ctx.org.settings).defaultGrants, today: dateKey(new Date()), legalRep } : undefined}
      accesses={accesses}
    />
  )
}
