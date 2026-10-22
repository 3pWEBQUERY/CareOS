import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate } from '@/lib/time'
import { INTL_LOCALE } from '@/i18n/core'
import { parseUserAgent } from '@/lib/admin-shared'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { AdminHead } from '../Head'
import { auditWhere, type AuditFilter } from './filter'
import { auditLabel } from '../audit-label'
import { Combobox, DateField, Select, TextField } from '@/components/ui/fields'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.audit')} · ${t('nav.admin')}` }
}

const PER_PAGE = 50
const COUNT_CAP = 10_000

/**
 * Objekttypen im Protokoll der Organisation. Rekursiver Index-Sprung über (entityType, entityId): je Typ ein
 * Indexzugriff statt DISTINCT über Hunderttausende Einträge.
 */
async function auditEntityTypes(orgId: string) {
  return db.$queryRaw<{ entityType: string }[]>`
    WITH RECURSIVE t AS (
      (SELECT "entityType" AS et FROM "AuditLog" ORDER BY "entityType" LIMIT 1)
      UNION ALL
      SELECT (SELECT "entityType" FROM "AuditLog" WHERE "entityType" > t.et ORDER BY "entityType" LIMIT 1) FROM t WHERE t.et IS NOT NULL
    )
    SELECT et AS "entityType" FROM t
    WHERE et IS NOT NULL AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."entityType" = t.et AND a."orgId" = ${orgId})
    ORDER BY et`
}
const json = (v: unknown) => JSON.stringify(v, null, 2)

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditFilter> }) {
  const ctx = await getCtx()
  const { t, org, locale } = ctx
  if (!ctx.can('admin.audit')) return <Forbidden text={t('common.notAllowed')} />
  const f = await searchParams
  const page = Math.max(1, Number(f.page) || 1)
  const where = auditWhere(org.id, f)
  // Grosse Protokolle (PRD §66): Zählung begrenzt (Seitenzahl «…+»), Objekttypen per Index-Sprung statt DISTINCT über alle Einträge
  const [rows, counted, users, entities] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.auditLog.count({ where, take: COUNT_CAP + 1 }),
    db.user.findMany({ where: { orgId: org.id }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
    auditEntityTypes(org.id),
  ])
  const capped = counted > COUNT_CAP
  // Begrenzt gezählt: weiterblättern bleibt möglich, solange eine volle Seite kommt
  const total = capped ? Math.max(COUNT_CAP + 1, (page - 1) * PER_PAGE + rows.length + (rows.length === PER_PAGE ? 1 : 0)) : counted
  const name = new Map(users.map((u) => [u.id, `${u.lastName} ${u.firstName}`]))
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const qs = (p: Partial<AuditFilter>) => {
    const s = new URLSearchParams()
    for (const [k, v] of Object.entries({ user: f.user, action: f.action, entity: f.entity, from: f.from, to: f.to, ...p })) if (v) s.set(k, String(v))
    return s.toString()
  }
  const dt = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const filtered = !!(f.user || f.action || f.entity || f.from || f.to)

  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.audit')} sub={t('admin.audit.sub')}>
        <a className="btn" href={`/admin/audit/export?${qs({})}`} download>{t('admin.audit.exportCsv')}</a>
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          <div className="alert info"><span className="grow">{t('admin.audit.immutable')}</span></div>
          <form className="form-grid" action="/admin/audit" role="search" aria-label={t('common.filter')}>
            <Combobox label={t('admin.audit.user')} name="user" defaultValue={f.user ?? ''} placeholder={t('common.all')}
              options={users.map((u) => ({ value: u.id, label: `${u.lastName} ${u.firstName}` }))} />
            <Combobox label={t('admin.audit.actionPrefix')} name="action" defaultValue={f.action ?? ''} placeholder="admin. / auth. / chart." freeText
              options={['auth.', 'admin.', 'profile.', 'api.', 'file.', 'resident.', 'chart.', 'medication.'].map((p) => ({ value: p, label: p }))} />
            <Select label={t('admin.audit.entity')} name="entity" defaultValue={f.entity ?? ''}>
                <option value="">{t('common.all')}</option>
                {entities.map((e) => <option key={e.entityType} value={e.entityType}>{e.entityType}</option>)}
              </Select>
            <DateField label={t('admin.audit.from')} name="from" defaultValue={f.from ?? ''} />
            <DateField label={t('admin.audit.to')} name="to" defaultValue={f.to ?? ''} />
            <div className="row" style={{ alignSelf: 'end' }}>
              <button className="btn primary" type="submit">{t('common.filter')}</button>
              {filtered && <Link className="btn ghost" href="/admin/audit">{t('admin.audit.reset')}</Link>}
            </div>
          </form>
          <div className="row-between">
            <span className="small muted">{capped ? t('admin.audit.countCapped', { n: new Intl.NumberFormat(INTL_LOCALE[locale]).format(COUNT_CAP) }) : t('admin.audit.count', { n: total })}</span>
            {pages > 1 && <span className="small muted mono">{page} / {pages}{capped ? '+' : ''}</span>}
          </div>
          {rows.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('admin.audit.at')}</th><th>{t('admin.audit.user')}</th><th>{t('admin.audit.action')}</th><th>{t('admin.audit.entity')}</th><th>{t('admin.audit.device')}</th><th>{t('admin.audit.details')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const ua = parseUserAgent(r.userAgent)
                    const has = r.before != null || r.after != null || r.context != null
                    return (
                      <tr key={String(r.id)}>
                        <td className="num nowrap">{dt(r.at)}<div className="small muted">#{String(r.id)}</div></td>
                        <td className="small">{r.userId ? <Link href={`/admin/audit?${qs({ user: r.userId, page: undefined })}`}>{name.get(r.userId) ?? r.userId.slice(0, 8)}</Link> : <span className="muted">{t('admin.audit.system')}</span>}</td>
                        <td>
                          {auditLabel(t, r.action) && <div className="small">{auditLabel(t, r.action)}</div>}
                          <code className="mono small">{r.action}</code>
                          {r.action.includes('failed') && <> <span className="tag crit">{t('admin.audit.failed')}</span></>}
                        </td>
                        <td className="small">{r.entityType}{r.entityId && <div className="mono muted" title={r.entityId}>{r.entityId.length > 14 ? r.entityId.slice(0, 12) + '…' : r.entityId}</div>}</td>
                        <td className="small">{r.ip && <span className="mono">{r.ip}</span>}{r.userAgent && <div className="muted">{[ua.browser, ua.os].filter(Boolean).join(' · ')}</div>}</td>
                        <td style={{ minWidth: 120 }}>
                          {has ? (
                            <details>
                              <summary className="linkbtn small" style={{ cursor: 'pointer' }}>{t('admin.audit.show')}</summary>
                              <div className="stack-sm" style={{ marginTop: 6, minWidth: 'min(520px, 70vw)' }}>
                                {([['before', r.before], ['after', r.after], ['context', r.context]] as const).map(([k, v]) => v != null && (
                                  <div key={k}>
                                    <span className="lbl">{t('admin.audit.' + k)}</span>
                                    <pre className="mono small" style={{ margin: '2px 0 0', padding: '6px 8px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto' }}>{json(v)}</pre>
                                  </div>
                                ))}
                                {r.sessionId && <span className="small muted mono">{t('admin.audit.session')}: {r.sessionId}</span>}
                              </div>
                            </details>
                          ) : <span className="small muted">–</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('admin.audit.empty')} />}
          {pages > 1 && (
            <nav className="row" aria-label={t('admin.audit.pages')} style={{ justifyContent: 'center' }}>
              {page > 1 ? <Link className="btn sm" href={`/admin/audit?${qs({ page: String(page - 1) })}`}>{t('admin.audit.newer')}</Link> : <span className="btn sm" aria-disabled="true">{t('admin.audit.newer')}</span>}
              <span className="small muted mono">{page} / {pages}{capped ? '+' : ''}</span>
              {page < pages ? <Link className="btn sm" href={`/admin/audit?${qs({ page: String(page + 1) })}`}>{t('admin.audit.older')}</Link> : <span className="btn sm" aria-disabled="true">{t('admin.audit.older')}</span>}
            </nav>
          )}
        </div>
      </div>
    </main>
  )
}
