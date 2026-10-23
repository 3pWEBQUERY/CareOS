import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { usersWithPermission } from '@/lib/notify'
import { notifyT } from '@/lib/notify-t'
import { dueForEscalation } from '@/lib/phone-orders'

/** Offene Gegenzeichnungen (Prisma-Bedingung): telefonisch/mündlich, noch nicht gegengezeichnet. */
export const PENDING_CONFIRM = { orderSource: { in: ['phone', 'verbal'] }, confirmedAt: null } satisfies Prisma.MedicationWhereInput

/**
 * Eskalation nach Fristablauf (läuft im Job «escalations», einmal je Verordnung): Meldung an die anordnende
 * Ärztin/den anordnenden Arzt (falls Konto) und an die Leitung des Bereichs. Gegenzeichnung bleibt offen.
 */
export async function escalatePhoneOrders(now = new Date()): Promise<number> {
  const meds = await db.medication.findMany({
    where: { ...PENDING_CONFIRM, confirmDueAt: { lte: now }, confirmEscalatedAt: null },
    include: { resident: { select: { id: true, orgId: true, unitId: true, firstName: true, lastName: true } } },
    take: 200,
  })
  let n = 0
  for (const m of meds) {
    if (!dueForEscalation(m, now)) continue
    // Doppelte Meldung bei parallelen Läufen verhindern: nur wer den Merker setzt, meldet
    const claimed = await db.medication.updateMany({ where: { id: m.id, confirmEscalatedAt: null, confirmedAt: null }, data: { confirmEscalatedAt: now } })
    if (!claimed.count) continue
    const r = m.resident
    const leads = await usersWithPermission(r.orgId, 'schedule.manage', r.unitId)
    const physician = m.orderedById ? await db.user.findFirst({ where: { id: m.orderedById, orgId: r.orgId, active: true }, select: { id: true, kind: true } }) : null
    const base = { orgId: r.orgId, priority: 'action' as const, kind: 'medication.phone.overdue', unitId: r.unitId, dutyAware: false, titleKey: 'meds.phone.notify.overdueTitle', bodyKey: 'meds.phone.notify.overdueBody', vars: { drug: m.name, name: `${r.lastName} ${r.firstName}` }, groupKey: 'phone-order:' + m.id }
    const staff = [...new Set([...leads, ...(physician && physician.kind !== 'external_physician' ? [physician.id] : [])])]
    await notifyT({ ...base, userIds: staff, href: `/residents/${r.id}/meds#orders` })
    // Externe Ärztin/externer Arzt: Link ins Ärzteportal
    if (physician?.kind === 'external_physician') await notifyT({ ...base, userIds: [physician.id], href: `/md/p/${r.id}#orders` })
    const userIds = [...staff, ...(physician?.kind === 'external_physician' ? [physician.id] : [])]
    await auditSystem({ orgId: r.orgId, action: 'medication.order.confirm.escalate', entityType: 'Medication', entityId: m.id, context: { residentId: r.id, dueAt: m.confirmDueAt, notified: userIds.length } })
    n++
  }
  return n
}
