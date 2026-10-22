import 'server-only'
import type { NotificationPriority } from '@prisma/client'
import { db } from '@/lib/db'
import { dutyRecipients, notify } from '@/lib/notify'
import { dictionary } from '@/i18n'
import { makeT, type Locale, type Terminology, type Vars } from '@/i18n/core'

/**
 * Benachrichtigung in der Sprache jeder empfangenden Person (Docs, Learn).
 * titleKey/bodyKey sind i18n-Schlüssel; Variablen werden je Sprache eingesetzt.
 */
export async function notifyT(n: {
  orgId: string
  userIds: string[]
  priority: NotificationPriority
  kind: string
  titleKey: string
  bodyKey?: string
  vars?: Vars
  href?: string
  groupKey?: string
  /** Bereich für die dienstbewusste Zustellung (src/lib/notify.ts) */
  unitId?: string | null
  dutyAware?: boolean
}) {
  // Dienstbewusste Auswahl einmal für alle Empfangenden, danach nach Sprache aufteilen.
  const ids = (await dutyRecipients(n)).userIds
  if (!ids.length) return
  const [users, org] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, orgId: n.orgId, active: true }, select: { id: true, locale: true } }),
    db.organization.findUnique({ where: { id: n.orgId }, select: { terminology: true } }),
  ])
  const byLocale = new Map<Locale, string[]>()
  for (const u of users) byLocale.set(u.locale as Locale, [...(byLocale.get(u.locale as Locale) ?? []), u.id])
  for (const [locale, userIds] of byLocale) {
    const t = makeT(dictionary(locale), locale, (org?.terminology ?? 'resident') as Terminology)
    await notify({
      orgId: n.orgId,
      userIds,
      priority: n.priority,
      kind: n.kind,
      title: t(n.titleKey, n.vars),
      body: n.bodyKey ? t(n.bodyKey, n.vars) : undefined,
      href: n.href,
      groupKey: n.groupKey,
      unitId: n.unitId,
      dutyAware: false,
    })
  }
}
