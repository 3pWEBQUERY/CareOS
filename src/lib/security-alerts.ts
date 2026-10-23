import 'server-only'
import { createHmac } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { log } from '@/lib/log'
import { count } from '@/lib/metrics'
import { notifyT } from '@/lib/notify-t'
import { usersWithPermission } from '@/lib/notify'
import { auditSystem } from '@/lib/audit'
import { LONG_WINDOW, escalates, evaluateRules, securityThresholds, windowOf, type AuditRow, type Severity } from '@/lib/security-rules'

/**
 * Audit-Überwachung (PRD §37): Job «security» alle 5 Minuten (src/lib/jobs.ts).
 * Liest die Audit-Einträge der letzten Stunde, wertet die Musterregeln aus (src/lib/security-rules.ts),
 * speichert Alarme in SecurityAlert und benachrichtigt Personen mit `admin.audit` (Sicherheit/Datenschutz)
 * bei neuen Alarmen oder höherer Stufe. Push enthält nur einen allgemeinen Hinweis (kind «security»).
 */
const WATCHED = [
  'auth.login_failed', 'auth.mfa_failed', 'profile.mfa_code_failed', 'resident.view', 'file.view',
  'resident.export', 'admin.export.org', 'admin.audit.export', 'api.auth_failed',
  'admin.role.create', 'admin.role.update', 'admin.role.delete', 'admin.user.role_assign', 'admin.user.role_remove',
  'admin.user.mfa_reset', 'admin.user.password_reset', 'admin.user.create', 'admin.user.invite',
  'admin.api_token.create', 'admin.api_token.revoke', 'admin.user.sessions_revoked',
  // Angehörigenportal (Paket A)
  'portal.login_failed', 'portal.mfa_failed',
]

/** IP nie im Klartext im Alarm: HMAC mit APP_SECRET (stabil je Installation). */
export const ipKey = (ip: string) => createHmac('sha256', process.env.APP_SECRET || 'careos-dev').update(ip).digest('base64url').slice(0, 16)
/** Für die Anzeige: letzte Stelle maskiert (203.0.113.x, 2001:db8:…). */
export const maskIp = (ip: string) => (ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':…' : ip.split('.').slice(0, 3).join('.') + '.x')

const PRIORITY: Record<Severity, 'critical' | 'action' | 'info'> = { critical: 'critical', warning: 'action', info: 'info' }

export async function runSecurityMonitor(now = new Date()) {
  const since = windowOf(new Date(now.getTime() - LONG_WINDOW), LONG_WINDOW).start
  const rows = await db.auditLog.findMany({
    where: { at: { gte: since, lte: now }, action: { in: WATCHED } },
    select: { at: true, orgId: true, userId: true, action: true, entityType: true, entityId: true, ip: true },
    orderBy: { at: 'asc' },
    take: 200_000,
  })
  const orgs = await db.organization.findMany({ select: { id: true, settings: true } })
  const settings = new Map(orgs.map((o) => [o.id, o.settings]))
  const masked = new Map<string, string>()
  const key = (ip: string) => {
    const k = ipKey(ip)
    masked.set(k, maskIp(ip))
    return k
  }
  const candidates = evaluateRules(rows as AuditRow[], {
    thresholds: (orgId) => securityThresholds(settings.get(orgId)),
    ipKey: key,
    soleOrgId: orgs.length === 1 ? orgs[0].id : null,
  })

  let created = 0
  let escalated = 0
  for (const c of candidates) {
    const details = { ...c.details, ...(c.subject.startsWith('ip:') ? { ip: masked.get(c.subject.slice(3)) ?? null } : {}) } as Prisma.InputJsonValue
    const where = { orgId_rule_subject_windowStart: { orgId: c.orgId, rule: c.rule, subject: c.subject, windowStart: c.windowStart } }
    const prev = await db.securityAlert.findUnique({ where, select: { id: true, severity: true, status: true } })
    const alert = prev
      ? await db.securityAlert.update({ where: { id: prev.id }, data: { count: c.count, details, severity: escalates(prev.severity as Severity, c.severity) ? c.severity : prev.severity } })
      : await db.securityAlert.create({ data: { orgId: c.orgId, rule: c.rule, severity: c.severity, subject: c.subject, userId: c.userId, count: c.count, windowStart: c.windowStart, windowEnd: c.windowEnd, details } })
    const isNew = !prev
    const higher = prev ? escalates(prev.severity as Severity, c.severity) && prev.severity !== c.severity : false
    if (!isNew && !higher) continue
    if (isNew) created++
    else escalated++
    count('careos_security_alerts_total', { rule: c.rule, severity: c.severity })
    log.warn('security.alert', { rule: c.rule, severity: c.severity, count: c.count, orgId: c.orgId, alertId: alert.id })
    await auditSystem({ action: isNew ? 'security.alert' : 'security.alert.escalate', entityType: 'SecurityAlert', entityId: alert.id, orgId: c.orgId, after: { rule: c.rule, severity: c.severity, count: c.count } })
    const recipients = await usersWithPermission(c.orgId, 'admin.audit')
    const who = c.userId ? await db.user.findUnique({ where: { id: c.userId }, select: { firstName: true, lastName: true } }) : null
    await notifyT({
      orgId: c.orgId,
      userIds: recipients,
      priority: PRIORITY[c.severity],
      kind: 'security',
      titleKey: `platform.security.notify.${c.rule}`,
      bodyKey: 'platform.security.notify.body',
      vars: { n: c.count, who: who ? `${who.firstName} ${who.lastName}` : (details as Record<string, unknown>).ip as string ?? '–' },
      href: `/admin/security?alert=${alert.id}`,
      groupKey: `security:${c.rule}:${c.subject}`,
    })
  }
  return { scanned: rows.length, candidates: candidates.length, created, escalated }
}
