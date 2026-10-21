import 'server-only'
import { db } from '@/lib/db'

/** Letzte Einreichung eines Entwurfs zur Freigabe, falls seitdem nichts mehr geändert wurde. */
export async function submissionOf(orgId: string, planId: string) {
  const last = await db.auditLog.findFirst({
    where: { orgId, context: { path: ['carePlanId'], equals: planId }, action: { not: 'careplan.suggestion.dismiss' } },
    orderBy: { at: 'desc' },
    select: { action: true, at: true, userId: true },
  })
  return last?.action === 'careplan.submit' ? last : null
}
