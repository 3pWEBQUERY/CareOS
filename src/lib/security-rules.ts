/**
 * Musterregeln der Audit-Überwachung (PRD §37 Angriffserkennung) – reine Logik, testbar.
 * Eingabe: Audit-Einträge eines Zeitraums. Ausgabe: Alarme je Regel, Gegenstand (Person/IP) und Zeitfenster.
 * Fenster sind an festen Grenzen ausgerichtet (z. B. 10:00–10:15), damit wiederholte Läufe denselben Alarm
 * aktualisieren statt neue zu erzeugen (Unique-Schlüssel orgId + rule + subject + windowStart).
 */

export type AuditRow = {
  at: Date
  orgId: string | null
  userId: string | null
  action: string
  entityType: string
  entityId: string | null
  ip: string | null
  context?: unknown
}

export type Severity = 'critical' | 'warning' | 'info'
export const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

export const RULES = ['login_failures', 'mfa_failures', 'mass_access', 'export', 'permission_change', 'api_failures'] as const
export type Rule = (typeof RULES)[number]

export type Thresholds = {
  /** Fehlanmeldungen je Konto im Fenster: Warnung / kritisch */
  loginUser: [number, number]
  /** Fehlanmeldungen je IP-Adresse über alle Konten */
  loginIp: [number, number]
  /** Fehlgeschlagene Zweitfaktor-Codes je Person */
  mfa: [number, number]
  /** Verschiedene Akten (Bewohnende/Dateien) je Person im Fenster */
  massAccess: [number, number]
  /** Exporte einzelner Akten je Person und Stunde */
  residentExports: [number, number]
  /** Rechteänderungen je Person und Stunde, ab denen der Alarm Warnstufe hat */
  permissionBurst: number
  /** Fehlgeschlagene API-Anmeldungen je Token/IP */
  api: [number, number]
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  loginUser: [5, 15],
  loginIp: [15, 50],
  mfa: [5, 12],
  massAccess: [30, 80],
  residentExports: [3, 10],
  permissionBurst: 10,
  api: [20, 100],
}

export const SHORT_WINDOW = 15 * 60_000
export const LONG_WINDOW = 60 * 60_000

/** Schwellen aus Organization.settings.security (Admin → Sicherheit), mit Mindestwerten gegen Fehlbedienung. */
export function securityThresholds(settings: unknown): Thresholds {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).security : null
  const t = s && typeof s === 'object' ? (s as Record<string, unknown>).thresholds : null
  const src = t && typeof t === 'object' ? (t as Record<string, unknown>) : {}
  const pair = (k: keyof Thresholds, min: number): [number, number] => {
    const d = DEFAULT_THRESHOLDS[k] as [number, number]
    const v = src[k]
    if (!Array.isArray(v) || v.length !== 2) return d
    const a = Math.max(min, Math.round(Number(v[0]) || d[0]))
    const b = Math.max(a + 1, Math.round(Number(v[1]) || d[1]))
    return [a, b]
  }
  return {
    loginUser: pair('loginUser', 3),
    loginIp: pair('loginIp', 5),
    mfa: pair('mfa', 3),
    massAccess: pair('massAccess', 10),
    residentExports: pair('residentExports', 2),
    permissionBurst: Math.max(2, Math.round(Number(src.permissionBurst) || DEFAULT_THRESHOLDS.permissionBurst)),
    api: pair('api', 5),
  }
}

export type AlertCandidate = {
  orgId: string
  rule: Rule
  severity: Severity
  subject: string
  userId: string | null
  count: number
  windowStart: Date
  windowEnd: Date
  details: Record<string, unknown>
}

export const windowOf = (at: Date, size: number) => {
  const start = Math.floor(at.getTime() / size) * size
  return { start: new Date(start), end: new Date(start + size) }
}

const PERMISSION_ACTIONS = new Set([
  'admin.role.create', 'admin.role.update', 'admin.role.delete',
  'admin.user.role_assign', 'admin.user.role_remove', 'admin.user.mfa_reset', 'admin.user.password_reset',
  'admin.user.create', 'admin.user.invite', 'admin.api_token.create', 'admin.api_token.revoke', 'admin.user.sessions_revoked',
])
const ORG_EXPORTS = new Set(['admin.export.org', 'admin.audit.export'])
const ACCESS = new Set(['resident.view', 'file.view'])

const sev = (n: number, [warn, crit]: [number, number]): Severity | null => (n >= crit ? 'critical' : n >= warn ? 'warning' : null)

type Group = { orgId: string; rule: Rule; subject: string; userId: string | null; size: number; rows: AuditRow[] }

/**
 * Wertet Audit-Einträge aus. ipKey: Hash der IP (keine IP im Klartext in Alarmen).
 * soleOrgId: Fehlanmeldungen unbekannter Konten haben keine Organisation – bei genau einer Organisation dieser zuordnen.
 */
export function evaluateRules(
  rows: AuditRow[],
  opts: { thresholds: (orgId: string) => Thresholds; ipKey: (ip: string) => string; soleOrgId?: string | null },
): AlertCandidate[] {
  const groups = new Map<string, Group>()
  const add = (rule: Rule, orgId: string | null, subject: string, userId: string | null, size: number, r: AuditRow) => {
    if (!orgId) return
    const w = windowOf(r.at, size)
    const k = `${orgId}|${rule}|${subject}|${w.start.getTime()}`
    const g = groups.get(k) ?? { orgId, rule, subject, userId, size, rows: [] }
    g.rows.push(r)
    groups.set(k, g)
  }
  for (const r of rows) {
    const org = r.orgId ?? opts.soleOrgId ?? null
    switch (true) {
      case r.action === 'auth.login_failed':
        if (r.entityId) add('login_failures', org, 'user:' + r.entityId, r.entityId, SHORT_WINDOW, r)
        if (r.ip) add('login_failures', org, 'ip:' + opts.ipKey(r.ip), null, SHORT_WINDOW, r)
        break
      // Angehörigenportal (eigene Konten): gleiche Regeln, Gegenstand «portal:<Konto>», keine Person der Organisation
      case r.action === 'portal.login_failed':
        if (r.entityId) add('login_failures', org, 'portal:' + r.entityId, null, SHORT_WINDOW, r)
        if (r.ip) add('login_failures', org, 'ip:' + opts.ipKey(r.ip), null, SHORT_WINDOW, r)
        break
      case r.action === 'portal.mfa_failed':
        if (r.entityId) add('mfa_failures', org, 'portal:' + r.entityId, null, SHORT_WINDOW, r)
        break
      case r.action === 'auth.mfa_failed' || r.action === 'profile.mfa_code_failed':
        if (r.userId || r.entityId) add('mfa_failures', org, 'user:' + (r.userId ?? r.entityId), r.userId ?? r.entityId, SHORT_WINDOW, r)
        break
      case ACCESS.has(r.action):
        if (r.userId) add('mass_access', org, 'user:' + r.userId, r.userId, SHORT_WINDOW, r)
        break
      case r.action === 'resident.export' || ORG_EXPORTS.has(r.action):
        if (r.userId) add('export', org, 'user:' + r.userId, r.userId, LONG_WINDOW, r)
        break
      case PERMISSION_ACTIONS.has(r.action):
        if (r.userId) add('permission_change', org, 'user:' + r.userId, r.userId, LONG_WINDOW, r)
        break
      case r.action === 'api.auth_failed':
        add('api_failures', org, r.entityId ? 'token:' + r.entityId : 'ip:' + opts.ipKey(r.ip ?? 'unknown'), null, SHORT_WINDOW, r)
        break
    }
  }

  const out: AlertCandidate[] = []
  for (const g of groups.values()) {
    const th = opts.thresholds(g.orgId)
    const w = windowOf(g.rows[0].at, g.size)
    const base = { orgId: g.orgId, rule: g.rule, subject: g.subject, userId: g.userId, windowStart: w.start, windowEnd: w.end }
    const isIp = g.subject.startsWith('ip:')
    let severity: Severity | null = null
    let n = g.rows.length
    const details: Record<string, unknown> = { first: g.rows[0].at.toISOString(), last: g.rows[g.rows.length - 1].at.toISOString() }
    switch (g.rule) {
      case 'login_failures': {
        severity = sev(n, isIp ? th.loginIp : th.loginUser)
        if (isIp) details.accounts = new Set(g.rows.map((r) => r.entityId ?? 'unknown')).size
        break
      }
      case 'mfa_failures':
        severity = sev(n, th.mfa)
        break
      case 'mass_access': {
        // Verschiedene Akten zählen, nicht Seitenaufrufe derselben Akte.
        const residents = new Set(g.rows.filter((r) => r.action === 'resident.view').map((r) => r.entityId))
        const files = new Set(g.rows.filter((r) => r.action === 'file.view').map((r) => r.entityId))
        n = residents.size + files.size
        severity = sev(n, th.massAccess)
        details.residents = residents.size
        details.files = files.size
        break
      }
      case 'export': {
        const org = g.rows.filter((r) => r.action === 'admin.export.org').length
        const auditExports = g.rows.filter((r) => r.action === 'admin.audit.export').length
        const residents = g.rows.filter((r) => r.action === 'resident.export').length
        details.org = org
        details.audit = auditExports
        details.residents = residents
        // Organisationsexport (alle Daten) immer melden; Auditexport zur Kenntnis; Aktenexporte ab Schwelle.
        severity = sev(residents, th.residentExports) ?? (org ? 'warning' : auditExports ? 'info' : null)
        if (org && severity === 'info') severity = 'warning'
        break
      }
      case 'permission_change': {
        const actions: Record<string, number> = {}
        for (const r of g.rows) actions[r.action] = (actions[r.action] ?? 0) + 1
        details.actions = actions
        severity = n >= th.permissionBurst ? 'warning' : 'info'
        break
      }
      case 'api_failures':
        severity = sev(n, th.api)
        break
    }
    if (severity) out.push({ ...base, severity, count: n, details })
  }
  return out.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.windowStart.getTime() - b.windowStart.getTime())
}

/** Muss eine bestehende Meldung erneut benachrichtigen? Nur bei neuer oder höherer Stufe. */
export function escalates(prev: Severity | null, next: Severity) {
  return prev == null || SEVERITIES.indexOf(next) < SEVERITIES.indexOf(prev)
}
