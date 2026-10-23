import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { fmtDayMonth, hm, sameDay } from '@/lib/time'

/**
 * Konflikthinweis (PRD §32): wer hat zuletzt (ausser mir) geändert und wann – aus dem Audit-Protokoll.
 * `fields` sind bereits übersetzte Feldnamen. Text: residents.conflict.edited.
 */
export async function conflictMessage(ctx: Ctx, q: { entityType: string; entityId: string; actions: string[]; fields: string[] }) {
  const last = await db.auditLog.findFirst({
    where: { orgId: ctx.org.id, entityType: q.entityType, entityId: q.entityId, action: { in: q.actions }, userId: { not: ctx.user.id } },
    orderBy: { at: 'desc' }, select: { userId: true, at: true },
  })
  const u = last?.userId ? await db.user.findFirst({ where: { id: last.userId, orgId: ctx.org.id }, select: { firstName: true, lastName: true } }) : null
  const now = new Date()
  return ctx.t('residents.conflict.edited', {
    by: u ? `${u.firstName.charAt(0)}. ${u.lastName}` : '–',
    at: last ? (sameDay(last.at, now) ? hm(last.at) : `${fmtDayMonth(last.at, ctx.locale)} ${hm(last.at)}`) : '–',
    fields: q.fields.join(', '),
  })
}
