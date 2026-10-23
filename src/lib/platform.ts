import 'server-only'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { notifyT } from '@/lib/notify-t'
import { invalidateTaskGeneration } from '@/lib/tasks'
import { normalizeModules, type ModuleKey } from '@/lib/modules'
export { syncPlatformAdmins } from '@/lib/platform-sync'

/**
 * Plattform-Ebene (PRD §42 Platform → Organisation → …): Betrieb mehrerer Organisationen einer Installation.
 * Zugang nur mit `User.platformRole = 'operator'` (über PLATFORM_ADMIN_EMAILS zugewiesen, MFA Pflicht).
 * Der Plattform-Betrieb sieht nur Zählwerte – nie Personen- oder Gesundheitsdaten anderer Organisationen.
 * Jede Aktion wird im Audit-Protokoll der betroffenen Organisation vermerkt (`platform.*`, context.platform = true).
 */

export { PLATFORM_ROLE } from '@/lib/platform-sync'
import { PLATFORM_ROLE } from '@/lib/platform-sync'

type AuditActor = { org: { id: string }; user: { id: string }; sessionId: string; ip: string | null; userAgent: string | null }

/** Plattform-Aktion im Audit der Zielorganisation (und, falls verschieden, der eigenen) vermerken. */
export async function platformAudit(actor: AuditActor, orgId: string, action: string, e: { before?: unknown; after?: unknown; context?: Record<string, unknown> } = {}) {
  const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  const row = (o: string) => ({
    orgId: o, userId: actor.user.id, sessionId: actor.sessionId, action, entityType: 'Organization', entityId: orgId,
    before: json(e.before), after: json(e.after), context: { ...e.context, platform: true, actorOrgId: actor.org.id }, ip: actor.ip, userAgent: actor.userAgent,
  })
  await db.auditLog.createMany({ data: orgId === actor.org.id ? [row(orgId)] : [row(orgId), row(actor.org.id)] })
}

/**
 * Module einer Organisation setzen (Admin → Module und Plattform). Hält die Kompatibilitäts-Schalter
 * `FeatureFlag ai/voice` synchron und baut Aufgaben neu auf (Medikamentenaufgaben folgen dem Modul).
 */
export async function setOrgModules(orgId: string, list: readonly string[]) {
  const modules = normalizeModules(list)
  const before = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { modules: true } })
  const has = (k: ModuleKey) => modules.includes(k)
  await db.$transaction([
    db.organization.update({ where: { id: orgId }, data: { modules } }),
    ...[['ai', has('ai')], ['voice', has('dictation')]].map(([key, enabled]) =>
      db.featureFlag.upsert({ where: { orgId_key: { orgId, key: key as string } }, create: { orgId, key: key as string, enabled: enabled as boolean }, update: { enabled: enabled as boolean } }),
    ),
  ])
  if (before.modules.includes('medication') !== has('medication')) {
    const units = await db.unit.findMany({ where: { orgId }, select: { id: true } })
    for (const u of units) invalidateTaskGeneration(u.id)
  }
  return { before: normalizeModules(before.modules), after: modules }
}

/** Zählwerte je Organisation für die Plattform-Übersicht (keine Personendaten). */
export async function orgStats(now = new Date()) {
  const d7 = new Date(now.getTime() - 7 * 86_400_000)
  const d30 = new Date(now.getTime() - 30 * 86_400_000)
  const [orgs, users, residents, a7, a30, storage] = await Promise.all([
    db.organization.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, slug: true, createdAt: true, modules: true, suspendedAt: true, suspendedReason: true, dataRegion: true } }),
    db.user.groupBy({ by: ['orgId'], where: { active: true }, _count: { _all: true } }),
    db.resident.groupBy({ by: ['orgId'], where: { status: { in: ['active', 'absent'] } }, _count: { _all: true } }),
    db.user.groupBy({ by: ['orgId'], where: { lastLoginAt: { gte: d7 } }, _count: { _all: true } }),
    db.user.groupBy({ by: ['orgId'], where: { lastLoginAt: { gte: d30 } }, _count: { _all: true } }),
    db.fileObject.groupBy({ by: ['orgId'], _sum: { size: true } }),
  ])
  const m = <T extends { orgId: string }>(rows: T[], f: (r: T) => number) => new Map(rows.map((r) => [r.orgId, f(r)]))
  const u = m(users, (r) => r._count._all)
  const r = m(residents, (x) => x._count._all)
  const w7 = m(a7, (x) => x._count._all)
  const w30 = m(a30, (x) => x._count._all)
  const st = m(storage, (x) => x._sum.size ?? 0)
  return orgs.map((o) => ({
    ...o,
    modules: normalizeModules(o.modules),
    status: (o.suspendedAt ? (o.suspendedReason === 'pending' ? 'pending' : 'suspended') : 'active') as 'active' | 'pending' | 'suspended',
    users: u.get(o.id) ?? 0,
    residents: r.get(o.id) ?? 0,
    active7: w7.get(o.id) ?? 0,
    active30: w30.get(o.id) ?? 0,
    storage: st.get(o.id) ?? 0,
  }))
}

/** Plattform-Betreiber benachrichtigen (z. B. neuer Antrag über ORG_SIGNUP). Jede Person in ihrer eigenen Organisation. */
export async function notifyOperators(titleKey: string, bodyKey: string, vars: Record<string, string>, href: string, groupKey: string) {
  const ops = await db.user.findMany({ where: { platformRole: PLATFORM_ROLE, active: true }, select: { id: true, orgId: true } })
  const byOrg = new Map<string, string[]>()
  for (const o of ops) byOrg.set(o.orgId, [...(byOrg.get(o.orgId) ?? []), o.id])
  for (const [orgId, userIds] of byOrg) {
    await notifyT({ orgId, userIds, priority: 'action', kind: 'security.platform', titleKey, bodyKey, vars, href, groupKey, dutyAware: false })
      .catch((e) => log.warn('platform.notify_failed', { error: e instanceof Error ? e.message : String(e) }))
  }
}
