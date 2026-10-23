import 'server-only'
import { db } from '@/lib/db'
import { auditSystem } from '@/lib/audit'
import { notifyT } from '@/lib/notify-t'
import { usersWithPermission } from '@/lib/notify'
import { usersWithRoles } from '@/lib/escalations'
import { normalizeModules, orgHasModule } from '@/lib/modules'
import { reviewDueForEscalation, reviewEscalationRecipients } from '@/lib/docs-review'

/** Leitung für Docs-Freigaben: Pflegedienstleitung (Rolle) */
const LEAD_ROLES = ['nursing_director']

/**
 * Überfällige Freigaben (läuft im Job «escalations», einmal je Einreichung): Meldung an die übrigen
 * Freigabeberechtigten bzw. an die Leitung und die verantwortliche Person des Dokuments. Audit «document.review.escalate».
 */
export async function escalateDocReviews(now = new Date()): Promise<number> {
  const versions = await db.documentVersion.findMany({
    where: { submittedAt: { not: null }, approvedAt: null, reviewDueAt: { lt: now }, reviewEscalatedAt: null, document: { status: { not: 'archived' } } },
    include: { document: { select: { id: true, orgId: true, title: true, ownerId: true, org: { select: { modules: true } } } } },
    take: 200,
  })
  let n = 0
  for (const v of versions) {
    const doc = v.document
    if (!orgHasModule(normalizeModules(doc.org.modules), 'docs') || !reviewDueForEscalation(v, now)) continue
    // Nur wer den Merker setzt, meldet (parallele Läufe, Freigabe in der Zwischenzeit)
    const claimed = await db.documentVersion.updateMany({ where: { id: v.id, reviewEscalatedAt: null, approvedAt: null, submittedAt: { not: null } }, data: { reviewEscalatedAt: now } })
    if (!claimed.count) continue
    const [approvers, pdl] = await Promise.all([usersWithPermission(doc.orgId, 'docs.approve'), usersWithRoles(doc.orgId, LEAD_ROLES)])
    const userIds = reviewEscalationRecipients({ reviewerId: v.reviewerId, authorId: v.authorId, approvers, leads: [doc.ownerId, ...pdl] })
    const reviewer = v.reviewerId ? await db.user.findFirst({ where: { id: v.reviewerId, orgId: doc.orgId }, select: { firstName: true, lastName: true } }) : null
    await notifyT({
      orgId: doc.orgId, userIds, priority: 'action', kind: 'document.review.overdue', dutyAware: false,
      titleKey: 'docs.notify.overdueTitle', bodyKey: reviewer ? 'docs.notify.overdueAssigned' : 'docs.notify.overdueBody',
      vars: { title: doc.title, version: v.version, who: reviewer ? `${reviewer.firstName} ${reviewer.lastName}` : '' },
      href: `/docs/${doc.id}`, groupKey: `doc-review-esc:${v.id}`,
    })
    await auditSystem({ orgId: doc.orgId, action: 'document.review.escalate', entityType: 'DocumentVersion', entityId: v.id, context: { documentId: doc.id, version: v.version, reviewerId: v.reviewerId, dueAt: v.reviewDueAt, notified: userIds.length } })
    n++
  }
  return n
}
