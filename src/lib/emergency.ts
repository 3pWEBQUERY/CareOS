import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { audit, auditSystem } from '@/lib/audit'
import { log } from '@/lib/log'
import { notifyT } from '@/lib/notify-t'
import { emergencyExpiry } from '@/lib/emergency-core'

/**
 * Notfallzugriff (PRD §34/§37): befristeter Lesezugriff auf klinische Daten für Personen mit `admin.emergency`
 * (Systemadministration), die selbst keine klinische Rolle haben. Ablauf:
 * 1. Begründung (min. 20 Zeichen) und Dauer (30 Min. bis 4 Std.) → `EmergencyAccess`, Audit `emergency.start`,
 *    Sicherheitsalarm (Admin → Sicherheit) und Benachrichtigung an Pflegedienstleitung und Datenschutz (`admin.audit`).
 * 2. Während der Laufzeit ergänzt `getCtx()` einen organisationsweiten Lese-Grant (`emergencyGrant`) und protokolliert
 *    jeden Seitenaufruf (`emergency.view` mit Pfad, ohne Gesundheitsdaten). Die Shell zeigt ein Banner mit Restzeit.
 * 3. Ende durch Ablauf oder vorzeitig durch die Person bzw. PDL/Datenschutz → Audit `emergency.end`.
 */

type AuditCtx = Parameters<typeof audit>[0]

/** Laufender Zugriff der Person (höchstens einer). */
export async function activeEmergency(userId: string, now = new Date()) {
  return db.emergencyAccess.findFirst({ where: { userId, endedAt: null, expiresAt: { gt: now }, startedAt: { lte: now } }, orderBy: { startedAt: 'desc' } })
}

/** Empfangende: Pflegedienstleitung (Rolle nursing_director) und Personen mit admin.audit (Datenschutz), ohne die anfragende Person. */
export async function emergencyRecipients(orgId: string, exceptUserId: string) {
  const rows = await db.user.findMany({
    where: {
      orgId, active: true, id: { not: exceptUserId },
      roles: { some: { role: { orgId, OR: [{ key: 'nursing_director' }, { permissions: { has: 'admin.audit' } }] } } },
    },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function startEmergency(ctx: AuditCtx & { user: { id: string; firstName: string; lastName: string } }, reason: string, minutes: number) {
  const now = new Date()
  const access = await db.$transaction(async (tx) => {
    // Pro Person höchstens ein laufender Zugriff (Doppelklick, zwei Geräte)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'careos:emergency:' + ctx.user.id}))`
    const running = await tx.emergencyAccess.findFirst({ where: { userId: ctx.user.id, endedAt: null, expiresAt: { gt: now } }, select: { id: true } })
    if (running) return null
    const a = await tx.emergencyAccess.create({ data: { orgId: ctx.org.id, userId: ctx.user.id, reason, expiresAt: emergencyExpiry(now, minutes), sessionId: ctx.sessionId, startedAt: now } })
    await audit(ctx, { action: 'emergency.start', entityType: 'EmergencyAccess', entityId: a.id, after: { reason, minutes, expiresAt: a.expiresAt.toISOString() } }, tx)
    return a
  })
  if (!access) return null
  const name = `${ctx.user.firstName} ${ctx.user.lastName}`
  await db.securityAlert
    .create({
      data: {
        orgId: ctx.org.id, rule: 'emergency_access', severity: 'warning', userId: ctx.user.id, subject: 'user:' + ctx.user.id, count: 1,
        windowStart: access.startedAt, windowEnd: access.expiresAt, details: { accessId: access.id, minutes } as Prisma.InputJsonValue,
      },
    })
    .catch((e) => log.warn('emergency.alert_failed', { error: e instanceof Error ? e.message : String(e) }))
  const userIds = await emergencyRecipients(ctx.org.id, ctx.user.id)
  await notifyT({
    orgId: ctx.org.id, userIds, priority: 'critical', kind: 'security.emergency',
    titleKey: 'tenancy.emergency.notify.title', bodyKey: 'tenancy.emergency.notify.body', vars: { name, minutes },
    href: '/admin/emergency', groupKey: 'emergency:' + access.id, dutyAware: false,
  }).catch((e) => log.warn('emergency.notify_failed', { error: e instanceof Error ? e.message : String(e) }))
  return access
}

/** Vorzeitig beenden. `byOther` = PDL/Datenschutz beendet den Zugriff einer anderen Person. */
export async function endEmergency(ctx: AuditCtx, id: string) {
  const a = await db.emergencyAccess.findFirst({ where: { id, orgId: ctx.org.id } })
  if (!a || a.endedAt) return null
  const now = new Date()
  const r = await db.emergencyAccess.updateMany({ where: { id, endedAt: null }, data: { endedAt: now, endedById: ctx.user.id } })
  if (!r.count) return null
  await audit(ctx, { action: 'emergency.end', entityType: 'EmergencyAccess', entityId: id, before: { expiresAt: a.expiresAt.toISOString() }, after: { endedAt: now.toISOString() }, context: { byOther: a.userId !== ctx.user.id, views: a.views } })
  return a
}

/** Seitenaufruf während des Zugriffs protokollieren (aus getCtx, ohne Prefetch). Fehler blockieren die Seite nie. */
export async function logEmergencyView(e: { accessId: string; orgId: string; userId: string; sessionId: string; path: string; ip: string | null; userAgent: string | null }) {
  try {
    await db.$transaction([
      db.emergencyAccess.update({ where: { id: e.accessId }, data: { views: { increment: 1 } } }),
      db.auditLog.create({ data: { orgId: e.orgId, userId: e.userId, sessionId: e.sessionId, action: 'emergency.view', entityType: 'EmergencyAccess', entityId: e.accessId, context: { path: e.path.slice(0, 300) }, ip: e.ip, userAgent: e.userAgent } }),
    ])
  } catch (err) {
    log.warn('emergency.view_log_failed', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Abgelaufene Zugriffe einmalig als beendet protokollieren (aus der Admin-Seite; idempotent). */
export async function closeExpiredEmergencies(orgId: string, now = new Date()) {
  const expired = await db.emergencyAccess.findMany({ where: { orgId, endedAt: null, expiresAt: { lte: now } }, select: { id: true, userId: true, expiresAt: true, views: true } })
  for (const a of expired) {
    const r = await db.emergencyAccess.updateMany({ where: { id: a.id, endedAt: null }, data: { endedAt: a.expiresAt } })
    if (r.count) await auditSystem({ action: 'emergency.expired', entityType: 'EmergencyAccess', entityId: a.id, orgId, userId: a.userId, context: { views: a.views } })
  }
}
