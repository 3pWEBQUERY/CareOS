import 'server-only'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { platformAdminEmails } from '@/lib/platform-core'

export const PLATFORM_ROLE = 'operator'

/**
 * Konten aus PLATFORM_ADMIN_EMAILS zu Plattform-Betreibern machen (beim Serverstart aus src/instrumentation.ts
 * und beim Aufruf von /platform). Entzieht die Rolle nie automatisch (Entzug: Variable anpassen und
 * `UPDATE "User" SET "platformRole" = NULL WHERE email = …`).
 */
export async function syncPlatformAdmins(env: Record<string, string | undefined> = process.env) {
  const emails = platformAdminEmails(env)
  if (!emails.length) return 0
  const users = await db.user.findMany({ where: { email: { in: emails }, platformRole: null, active: true }, select: { id: true, orgId: true } })
  if (!users.length) return 0
  await db.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { platformRole: PLATFORM_ROLE } })
  await db.auditLog.createMany({ data: users.map((u) => ({ orgId: u.orgId, userId: u.id, action: 'platform.operator_assigned', entityType: 'User', entityId: u.id, context: { via: 'PLATFORM_ADMIN_EMAILS' } })) })
  log.info('platform.operators_assigned', { count: users.length })
  return users.length
}
