import 'server-only'
import type { NotificationPriority } from '@prisma/client'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import { pushForNotification } from '@/lib/push'
import { log } from '@/lib/log'
import { count } from '@/lib/metrics'
import { dutyState, unitFromHref } from '@/lib/duty'
import { LOCKED_IN_APP, categoryOf, normalizePrefs, selectRecipients, wantsInApp } from '@/lib/notify-prefs'

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
  /**
   * Bereich der Meldung. Klinische Meldungen an mehrere Personen gehen dienstbewusst nur an Personen im Dienst
   * (plus Stellvertretung, src/lib/notify-prefs.ts). Ohne Angabe wird der Bereich aus dem Link abgeleitet (Akte, Ereignis).
   */
  unitId?: string | null
  /** false: Empfängerliste nicht nach Dienst filtern (z. B. ausdrücklich adressierte Personen). */
  dutyAware?: boolean
}

/** Dienstbewusste Empfängerauswahl (auch von notifyT vor der Aufteilung nach Sprache genutzt). */
export async function dutyRecipients(n: Pick<NotifyInput, 'orgId' | 'userIds' | 'kind' | 'href' | 'unitId' | 'dutyAware'>): Promise<{ userIds: string[]; mode: string }> {
  const ids = [...new Set(n.userIds)]
  if (ids.length <= 1 || n.dutyAware === false || categoryOf(n.kind, n.href) !== 'clinical') return { userIds: ids, mode: 'personal' }
  const unitId = n.unitId !== undefined ? n.unitId : await unitFromHref(n.orgId, n.href)
  if (!unitId) return { userIds: ids, mode: 'org' }
  return selectRecipients(ids, await dutyState(n.orgId, ids, unitId))
}

/**
 * Erstellt priorisierte Benachrichtigungen (PRD §25) mit Bündelung.
 * Dienstbewusst: klinische Bereichsmeldungen nur an Personen im Dienst bzw. Stellvertretung.
 * Einstellungen je Art (Profil → Benachrichtigungen): In-App für nicht klinische Arten abschaltbar, Push je Art.
 */
export async function notify(n: NotifyInput) {
  const sel = await dutyRecipients(n)
  let ids = sel.userIds
  const mode = sel.mode
  if (!ids.length) return
  const category = categoryOf(n.kind, n.href)
  if (!LOCKED_IN_APP.includes(category) && n.priority !== 'critical') {
    const prefs = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, notificationPrefs: true } })
    const off = new Set(prefs.filter((u) => !wantsInApp(normalizePrefs(u.notificationPrefs), category, n.priority)).map((u) => u.id))
    ids = ids.filter((id) => !off.has(id))
  }
  if (!ids.length) return
  count('careos_notifications_total', { priority: n.priority, category, mode })

  // Bündeln: bestehende ungelesene Meldung mit gleichem groupKey aktualisieren, sonst gesammelt anlegen.
  const existing = n.groupKey
    ? await db.notification.findMany({ where: { userId: { in: ids }, groupKey: n.groupKey, readAt: null }, select: { id: true, userId: true } })
    : []
  if (existing.length) {
    await db.notification.updateMany({ where: { id: { in: existing.map((e) => e.id) } }, data: { title: n.title, body: n.body, href: n.href, createdAt: new Date(), priority: n.priority } })
  }
  const grouped = new Set(existing.map((e) => e.userId))
  const fresh = ids.filter((id) => !grouped.has(id))
  if (fresh.length) {
    await db.notification.createMany({
      data: fresh.map((userId) => ({ userId, priority: n.priority, kind: n.kind, title: n.title, body: n.body, href: n.href, groupKey: n.groupKey })),
    })
  }
  await emit({ orgId: n.orgId, type: 'notification.created', userIds: ids, payload: { priority: n.priority, title: n.title } })
  // Web Push (PRD §25) nach Einstellung der Person, ohne Gesundheitsdaten; blockiert die Aktion nicht.
  void pushForNotification({ ...n, userIds: ids }).catch((e) => log.error('push.failed', { error: e }))
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
