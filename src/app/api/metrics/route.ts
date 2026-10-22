import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { metricsToken } from '@/lib/env'
import { healthReport } from '@/lib/health'
import { processMetrics } from '@/lib/metrics'

export const dynamic = 'force-dynamic'

/**
 * Metriken im Prometheus-Textformat (PRD §66). Geschützt mit `Authorization: Bearer <METRICS_TOKEN>`;
 * ohne gesetztes METRICS_TOKEN ist der Endpunkt abgeschaltet (404). Nur Summen, keine Personendaten.
 * Prozesszähler gelten je Instanz (Label instance), Datenbankwerte für die ganze Installation.
 */
function authorized(req: Request) {
  const token = metricsToken()
  if (!token) return null
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

const line = (name: string, value: number | null | undefined, help: string, type: 'gauge' | 'counter' = 'gauge', labels = '') =>
  value == null ? [] : [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${value}`]

export async function GET(req: Request) {
  const ok = authorized(req)
  if (ok === null) return new Response('not found', { status: 404 })
  if (!ok) return new Response('unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } })

  const now = new Date()
  const day = new Date(now.getTime() - 24 * 3600_000)
  const r = await healthReport(now)
  const [sessions, openAlerts, errors24h, notifications24h, events5m, offlinePending, feedbackNew] = await Promise.all([
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - 15 * 60_000) } } }),
    db.securityAlert.groupBy({ by: ['severity'], where: { status: 'open' }, _count: { _all: true } }),
    db.errorEvent.aggregate({ where: { lastAt: { gt: day } }, _sum: { count: true } }),
    db.notification.count({ where: { createdAt: { gt: day } } }),
    db.domainEvent.count({ where: { createdAt: { gt: new Date(now.getTime() - 5 * 60_000) } } }),
    db.offlineOp.count({ where: { status: { in: ['pending', 'conflict'] } } }),
    db.feedback.count({ where: { status: 'new' } }),
  ])
  const up = (s: string | null | undefined) => (s === 'ok' ? 1 : s === 'off' ? null : 0)
  const out: string[] = [
    ...line('careos_up', r.status === 'error' ? 0 : 1, 'Instanz und Datenbank erreichbar'),
    ...line('careos_db_latency_ms', r.db.ms, 'Antwortzeit SELECT 1'),
    ...line('careos_storage_up', up(r.storage?.state), 'Bucket erreichbar (HeadBucket)'),
    ...line('careos_realtime_connections', r.realtime?.connections ?? 0, 'Offene SSE-Verbindungen dieser Instanz'),
    ...line('careos_uptime_seconds', r.uptimeS, 'Laufzeit dieser Instanz'),
    ...line('careos_process_resident_memory_bytes', process.memoryUsage().rss, 'Speicher dieser Instanz'),
    '# HELP careos_job_ok Letzter Lauf erfolgreich und rechtzeitig (1) oder nicht (0)',
    '# TYPE careos_job_ok gauge',
    ...r.jobs.map((j) => `careos_job_ok{job="${j.name}",state="${j.state}"} ${j.state === 'ok' || j.state === 'pending' ? 1 : 0}`),
    '# HELP careos_job_last_run_age_seconds Sekunden seit dem letzten Start',
    '# TYPE careos_job_last_run_age_seconds gauge',
    ...r.jobs.filter((j) => j.lastStartedAt).map((j) => `careos_job_last_run_age_seconds{job="${j.name}"} ${Math.round((now.getTime() - j.lastStartedAt!.getTime()) / 1000)}`),
    ...line('careos_active_sessions', sessions, 'Sitzungen mit Aktivität in den letzten 15 Minuten'),
    '# HELP careos_security_alerts_open Offene Sicherheitsalarme',
    '# TYPE careos_security_alerts_open gauge',
    ...['critical', 'warning', 'info'].map((s) => `careos_security_alerts_open{severity="${s}"} ${openAlerts.find((a) => a.severity === s)?._count._all ?? 0}`),
    ...line('careos_server_errors_24h', errors24h._sum.count ?? 0, 'Erfasste Serverfehler der letzten 24 Stunden'),
    ...line('careos_notifications_24h', notifications24h, 'Benachrichtigungen der letzten 24 Stunden'),
    ...line('careos_domain_events_5m', events5m, 'Domain Events der letzten 5 Minuten'),
    ...line('careos_offline_ops_open', offlinePending, 'Offline-Vorgänge mit Status pending oder conflict'),
    ...line('careos_feedback_new', feedbackNew, 'Neue Rückmeldungen'),
    ...processMetrics(),
  ]
  return new Response(out.join('\n') + '\n', { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } })
}
