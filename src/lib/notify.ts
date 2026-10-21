import 'server-only'
import type { NotificationPriority } from '@prisma/client'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'

export type NotifyInput = {
  orgId: string
  userIds: string[]
  priority: NotificationPriority
  kind: string
  title: string
  body?: string
  href?: string
  /** Gleichartige ungelesene Benachrichtigungen mit gleichem groupKey werden gebündelt statt dupliziert. */
  groupKey?: string
}

/** Erstellt priorisierte Benachrichtigungen (PRD §25) mit Bündelung. */
export async function notify(n: NotifyInput) {
  const ids = [...new Set(n.userIds)]
  if (!ids.length) return
  for (const userId of ids) {
    if (n.groupKey) {
      const existing = await db.notification.findFirst({ where: { userId, groupKey: n.groupKey, readAt: null } })
      if (existing) {
        await db.notification.update({ where: { id: existing.id }, data: { title: n.title, body: n.body, href: n.href, createdAt: new Date(), priority: n.priority } })
        continue
      }
    }
    await db.notification.create({
      data: { userId, priority: n.priority, kind: n.kind, title: n.title, body: n.body, href: n.href, groupKey: n.groupKey },
    })
  }
  await emit({ orgId: n.orgId, type: 'notification.created', userIds: ids, payload: { priority: n.priority, title: n.title } })
}

/** Benutzer einer Organisation mit einer bestimmten Berechtigung (optional im Bereich). */
export async function usersWithPermission(orgId: string, perm: string, unitId?: string | null) {
  const unit = unitId ? await db.unit.findUnique({ where: { id: unitId }, select: { locationId: true } }) : null
  const rows = await db.roleAssignment.findMany({
    where: { role: { orgId, permissions: { has: perm } }, user: { active: true } },
    select: { userId: true, unitId: true, locationId: true },
  })
  return [
    ...new Set(
      rows
        .filter((r) => !unitId || (!r.unitId && !r.locationId) || r.unitId === unitId || (unit && r.locationId === unit.locationId))
        .map((r) => r.userId),
    ),
  ]
}
