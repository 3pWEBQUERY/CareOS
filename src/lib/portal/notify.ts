import 'server-only'
import { db } from '@/lib/db'
import { usersWithPermission } from '@/lib/notify'
import { notifyT } from '@/lib/notify-t'

/**
 * Benachrichtigung an das Team bei neuer Nachricht oder Besuchsanfrage aus dem Portal.
 * Zugewiesen → nur diese Person; sonst alle mit portal.respond im Bereich, dienstbewusst (src/lib/notify.ts).
 * Die Meldung enthält nie den Nachrichtentext; Push zeigt nur einen allgemeinen Hinweis (klinische Art).
 * `self`: aus dem Bewohnerportal (die Person selbst) – gleicher Posteingang, eigener Titel.
 */
export async function notifyFamilyInbox(n: { orgId: string; residentId: string; kind: 'message' | 'visit'; itemId: string; assigneeId?: string | null; self?: boolean }) {
  const r = await db.resident.findFirst({ where: { id: n.residentId, orgId: n.orgId }, select: { unitId: true, firstName: true, lastName: true, room: { select: { number: true } } } })
  if (!r) return
  const assignee = n.assigneeId ? await db.user.findFirst({ where: { id: n.assigneeId, orgId: n.orgId, active: true }, select: { id: true } }) : null
  const userIds = assignee ? [assignee.id] : await usersWithPermission(n.orgId, 'portal.respond', r.unitId)
  if (!userIds.length) return
  await notifyT({
    orgId: n.orgId,
    userIds,
    priority: 'action',
    kind: 'portal.' + n.kind,
    titleKey: (n.self ? 'residentPortal.notify.' : 'portal.notify.') + n.kind,
    bodyKey: 'portal.notify.body',
    vars: { name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? '–' },
    href: `/team/family/${n.kind === 'message' ? 'm' : 'v'}/${n.itemId}`,
    groupKey: `portal:${n.kind}:${n.itemId}`,
    unitId: r.unitId,
    dutyAware: !assignee,
  })
}
