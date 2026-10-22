import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate } from '@/lib/time'
import { metricsToken } from '@/lib/env'
import { healthReport } from '@/lib/health'
import { securityThresholds, RULES, type Rule } from '@/lib/security-rules'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { Checkbox, DateTimeField, NumberField, RadioGroup, Select, TextField, Textarea } from '@/components/ui/fields'
import { AdminHead } from '../Head'
import { quickAlertStatusAction, saveIncidentAction, saveThresholdsAction, setAlertStatusAction } from './actions'
import { DATA_CATEGORIES, INCIDENT_KINDS, INCIDENT_RISKS, INCIDENT_STATUS, deadlineState, toDateTimeInput } from './parse'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('platform.security.title')} · ${t('nav.admin')}` }
}

const TABS = ['alerts', 'incidents', 'system'] as const
type Tab = (typeof TABS)[number]
type Ctx = Awaited<ReturnType<typeof getCtx>>

const SEV_TAG: Record<string, string> = { critical: 'crit', warning: 'warn', info: 'accent' }
const SEV_MARK: Record<string, string> = { critical: '▲▲', warning: '▲', info: '●' }

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ tab?: string; show?: string; alert?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.audit')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'alerts'
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('platform.security.title')} sub={t('platform.security.sub')} />
      <nav className="tabs" aria-label={t('platform.security.title')}>
        {TABS.map((k) => <Link key={k} href={`/admin/security?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{t('platform.security.tabs.' + k)}</Link>)}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'alerts' && <Alerts ctx={ctx} all={sp.show === 'all'} focus={sp.alert} />}
          {tab === 'incidents' && <Incidents ctx={ctx} />}
          {tab === 'system' && <System ctx={ctx} />}
        </div>
      </div>
    </main>
  )
}

const dt = (d: Date, ctx: Ctx) => fmtDate(d, ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const hm = (d: Date, ctx: Ctx) => fmtDate(d, ctx.locale, { hour: '2-digit', minute: '2-digit' })
const dayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function Alerts({ ctx, all, focus }: { ctx: Ctx; all: boolean; focus?: string }) {
  const { t } = ctx
  const week = new Date(Date.now() - 7 * 24 * 3600_000)
  const [alerts, open, weekCount, lastRun, org] = await Promise.all([
    db.securityAlert.findMany({ where: { orgId: ctx.org.id, ...(all ? {} : { status: { in: ['open', 'acknowledged'] } }) }, orderBy: [{ windowStart: 'desc' }], take: 200 }),
    db.securityAlert.groupBy({ by: ['severity'], where: { orgId: ctx.org.id, status: 'open' }, _count: { _all: true } }),
    db.securityAlert.count({ where: { orgId: ctx.org.id, createdAt: { gte: week } } }),
    db.jobRun.findFirst({ where: { name: 'security', ok: true }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    db.organization.findUnique({ where: { id: ctx.org.id }, select: { settings: true } }),
  ])
  const peopleIds = [...new Set(alerts.flatMap((a) => [a.userId, a.handledById]).filter((x): x is string => !!x))]
  const incidentIds = alerts.map((a) => a.incidentId).filter((x): x is string => !!x)
  const [people, incidents] = await Promise.all([
    db.user.findMany({ where: { id: { in: peopleIds }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } }),
    db.securityIncident.findMany({ where: { id: { in: incidentIds }, orgId: ctx.org.id }, select: { id: true, number: true } }),
  ])
  const name = new Map(people.map((u) => [u.id, `${u.firstName} ${u.lastName}`]))
  const incNo = new Map(incidents.map((i) => [i.id, i.number]))
  const n = (s: string) => open.find((o) => o.severity === s)?._count._all ?? 0
  const th = securityThresholds(org?.settings)
  const subject = (a: (typeof alerts)[number]) => {
    const d = (a.details ?? {}) as Record<string, unknown>
    if (a.subject.startsWith('ip:')) return t('platform.security.subjectIp', { ip: String(d.ip ?? '–') })
    if (a.subject.startsWith('token:')) return t('platform.security.subjectToken')
    return a.userId ? name.get(a.userId) ?? t('platform.security.unknownPerson') : '–'
  }
  const detail = (a: (typeof alerts)[number]) => {
    const d = (a.details ?? {}) as Record<string, number>
    const parts: string[] = []
    if (a.rule === 'login_failures' && d.accounts) parts.push(t('platform.security.details.accounts', { n: d.accounts }))
    if (a.rule === 'mass_access') parts.push(t('platform.security.details.residents', { n: d.residents ?? 0 }), t('platform.security.details.files', { n: d.files ?? 0 }))
    if (a.rule === 'export') {
      if (d.org) parts.push(t('platform.security.details.org'))
      if (d.audit) parts.push(t('platform.security.details.audit'))
      if (d.residents) parts.push(t('platform.security.details.residentExports', { n: d.residents }))
    }
    if (a.rule === 'permission_change' && d.actions && typeof d.actions === 'object') parts.push(Object.entries(d.actions as Record<string, number>).map(([k, v]) => `${k} ×${v}`).join(', '))
    return parts.join(' · ')
  }
  const auditHref = (a: (typeof alerts)[number]) => {
    const q = new URLSearchParams({ from: dayIso(a.windowStart), to: dayIso(a.windowEnd) })
    if (a.userId && a.rule !== 'login_failures') q.set('user', a.userId)
    const prefix: Record<Rule, string> = { login_failures: 'auth.login_failed', mfa_failures: '', mass_access: '', export: '', permission_change: 'admin.', api_failures: 'api.auth_failed' }
    if (prefix[a.rule as Rule]) q.set('action', prefix[a.rule as Rule])
    return '/admin/audit?' + q.toString()
  }
  return (
    <>
      <div className="metrics">
        <div className="metric"><span className="lbl">{t('platform.security.metrics.critical')}</span><span className={'val' + (n('critical') ? ' crit' : '')}>{n('critical')}</span></div>
        <div className="metric"><span className="lbl">{t('platform.security.metrics.warning')}</span><span className={'val' + (n('warning') ? ' warn' : '')}>{n('warning')}</span></div>
        <div className="metric"><span className="lbl">{t('platform.security.metrics.info')}</span><span className="val">{n('info')}</span></div>
        <div className="metric"><span className="lbl">{t('platform.security.metrics.week')}</span><span className="val">{weekCount}</span></div>
      </div>
      <div className="row-between">
        <nav className="chips" aria-label={t('platform.security.filter.label')}>
          <Link className="chip" href="/admin/security?tab=alerts" aria-current={!all ? 'page' : undefined}>{t('platform.security.filter.open')}</Link>
          <Link className="chip" href="/admin/security?tab=alerts&show=all" aria-current={all ? 'page' : undefined}>{t('platform.security.filter.all')}</Link>
        </nav>
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted">{lastRun ? t('platform.security.lastRun', { time: dt(lastRun.startedAt, ctx) }) : t('platform.security.notRunYet')}</span>
          <FormDialog label={t('platform.security.thresholds.edit')} buttonClass="btn sm" title={t('platform.security.thresholds.title')} action={saveThresholdsAction} submit={t('common.save')} success="platform.security.saved" wide>
            <p className="fg2" style={{ margin: 0 }}>{t('platform.security.thresholds.hint')}</p>
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('platform.security.col.rule')}</th><th>{t('platform.security.thresholds.warn')}</th><th>{t('platform.security.thresholds.crit')}</th></tr></thead>
                <tbody>
                  {(['loginUser', 'loginIp', 'mfa', 'massAccess', 'residentExports', 'api'] as const).map((k) => (
                    <tr key={k}>
                      <th scope="row" style={{ fontWeight: 400 }}>{t('platform.security.thresholds.' + k)}</th>
                      <td><NumberField name={k + '.warn'} label={`${t('platform.security.thresholds.' + k)} – ${t('platform.security.thresholds.warn')}`} hideLabel defaultValue={th[k][0]} min={2} step={1} required style={{ maxWidth: 110 }} /></td>
                      <td><NumberField name={k + '.crit'} label={`${t('platform.security.thresholds.' + k)} – ${t('platform.security.thresholds.crit')}`} hideLabel defaultValue={th[k][1]} min={3} step={1} required style={{ maxWidth: 110 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NumberField name="permissionBurst" label={t('platform.security.thresholds.permissionBurst')} defaultValue={th.permissionBurst} min={2} step={1} required style={{ maxWidth: 110 }} />
          </FormDialog>
        </div>
      </div>
      {alerts.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead>
              <tr>
                <th>{t('platform.security.col.window')}</th><th>{t('platform.security.col.rule')}</th><th>{t('platform.security.col.subject')}</th>
                <th className="right">{t('platform.security.col.count')}</th><th>{t('platform.security.col.severity')}</th><th>{t('platform.security.col.status')}</th>
                <th><span className="sr-only">{t('admin.common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} id={'alert-' + a.id} aria-current={focus === a.id ? 'true' : undefined}>
                  <td className="num nowrap">{dt(a.windowStart, ctx)}–{hm(a.windowEnd, ctx)}</td>
                  <td>
                    <div>{t('platform.security.rules.' + a.rule)}</div>
                    {detail(a) && <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{detail(a)}</div>}
                    {a.note && <div className="small fg2" style={{ overflowWrap: 'anywhere' }}>{a.note}</div>}
                  </td>
                  <td>{subject(a)}</td>
                  <td className="num right">{a.count}</td>
                  <td><span className={'tag ' + (SEV_TAG[a.severity] ?? '')}><span aria-hidden="true">{SEV_MARK[a.severity]} </span>{t('platform.security.severity.' + a.severity)}</span></td>
                  <td>
                    <span className={'tag' + (a.status === 'open' ? ' warn' : a.status === 'resolved' ? ' ok' : '')}>{t('platform.security.status.' + a.status)}</span>
                    {a.handledById && a.handledAt && <div className="small muted">{name.get(a.handledById) ?? '–'}, {dt(a.handledAt, ctx)}</div>}
                    {a.incidentId && incNo.has(a.incidentId) && <div className="small"><Link href="/admin/security?tab=incidents">{t('platform.security.linkedIncident', { n: incNo.get(a.incidentId)! })}</Link></div>}
                  </td>
                  <td className="right nowrap">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {a.status === 'open' && <ActBtn action={quickAlertStatusAction.bind(null, a.id, 'acknowledged')} className="btn sm" success="platform.security.saved">{t('platform.security.acknowledge')}</ActBtn>}
                      {(a.status === 'open' || a.status === 'acknowledged') && (
                        <FormDialog label={t('platform.security.resolve')} buttonClass="btn sm primary" title={`${t('platform.security.rules.' + a.rule)} · ${subject(a)}`} action={setAlertStatusAction} submit={t('common.save')} success="platform.security.saved">
                          <input type="hidden" name="id" value={a.id} />
                          <RadioGroup name="status" label={t('platform.security.col.status')} defaultValue="resolved" options={[
                            { value: 'resolved', label: t('platform.security.status.resolved') },
                            { value: 'false_positive', label: t('platform.security.status.false_positive') },
                            { value: 'acknowledged', label: t('platform.security.status.acknowledged') },
                          ]} />
                          <Textarea name="note" label={t('platform.security.note')} hint={t('platform.security.noteHint')} rows={3} maxLength={1000} defaultValue={a.note ?? ''} optional />
                        </FormDialog>
                      )}
                      {(a.status === 'resolved' || a.status === 'false_positive') && <ActBtn action={quickAlertStatusAction.bind(null, a.id, 'open')} className="btn sm ghost" success="platform.security.saved">{t('platform.security.reopen')}</ActBtn>}
                      {!a.incidentId && (
                        <FormDialog label={t('platform.security.toIncident')} buttonClass="btn sm ghost" title={t('platform.incidents.create')} action={saveIncidentAction} submit={t('platform.incidents.create')} success="platform.incidents.created" wide>
                          <input type="hidden" name="alertId" value={a.id} />
                          <IncidentFields ctx={ctx} preset={{ title: t('platform.incidents.fromAlert', { rule: t('platform.security.rules.' + a.rule) }), kind: 'confidentiality', discoveredAt: a.createdAt, description: [t('platform.security.rules.' + a.rule), subject(a), detail(a), `${dt(a.windowStart, ctx)}–${hm(a.windowEnd, ctx)}`].filter(Boolean).join(' · ') }} />
                        </FormDialog>
                      )}
                      <Link className="btn sm ghost" href={auditHref(a)}>{t('platform.security.toAudit')}</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={all ? t('platform.security.noneAll') : t('platform.security.none')}>{t('platform.security.noneHint')}</Empty>
      )}
      <h2 className="sec">{t('platform.security.thresholds.title')}</h2>
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--surface)' }}>
        {RULES.map((r) => (
          <li key={r}><div className="li"><div className="grow">{t('platform.security.rules.' + r)}</div><span className="small muted mono">{thresholdText(r, th)}</span></div></li>
        ))}
      </ul>
    </>
  )
}

function thresholdText(r: Rule, th: ReturnType<typeof securityThresholds>) {
  switch (r) {
    case 'login_failures': return `${th.loginUser.join(' / ')} · IP ${th.loginIp.join(' / ')}`
    case 'mfa_failures': return th.mfa.join(' / ')
    case 'mass_access': return th.massAccess.join(' / ')
    case 'export': return th.residentExports.join(' / ')
    case 'permission_change': return `≥ 1 · ${th.permissionBurst}`
    case 'api_failures': return th.api.join(' / ')
  }
}

type IncidentPreset = {
  id?: string; title?: string; kind?: string; description?: string; discoveredAt?: Date; occurredAt?: Date | null; risk?: string; dataCategories?: string[]
  affectedCount?: number | null; measures?: string | null; status?: string; authorityRequired?: boolean | null; authorityNotifiedAt?: Date | null
  subjectsRequired?: boolean | null; subjectsNotifiedAt?: Date | null
}

function IncidentFields({ ctx, preset = {} }: { ctx: Ctx; preset?: IncidentPreset }) {
  const { t } = ctx
  const tri = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '')
  const triOptions = [
    <option key="u" value="">{t('platform.incidents.tri.unknown')}</option>,
    <option key="y" value="yes">{t('platform.incidents.tri.yes')}</option>,
    <option key="n" value="no">{t('platform.incidents.tri.no')}</option>,
  ]
  return (
    <>
      {preset.id && <input type="hidden" name="id" value={preset.id} />}
      <div className="form-grid">
        <TextField label={t('platform.incidents.fields.title')} name="title" required minLength={3} maxLength={160} defaultValue={preset.title} wrapClassName="span-all" />
        <Select label={t('platform.incidents.fields.kind')} name="kind" defaultValue={preset.kind ?? 'confidentiality'} wrapClassName="span-all">
          {INCIDENT_KINDS.map((k) => <option key={k} value={k}>{t('platform.incidents.kinds.' + k)}</option>)}
        </Select>
        <Textarea label={t('platform.incidents.fields.description')} hint={t('platform.incidents.fields.descriptionHint')} name="description" rows={4} required minLength={10} maxLength={5000} defaultValue={preset.description} wrapClassName="span-all" />
        <DateTimeField label={t('platform.incidents.fields.discoveredAt')} name="discoveredAt" required defaultValue={toDateTimeInput(preset.discoveredAt ?? new Date())} />
        <DateTimeField label={t('platform.incidents.fields.occurredAt')} name="occurredAt" optional defaultValue={toDateTimeInput(preset.occurredAt)} />
        <Select label={t('platform.incidents.fields.risk')} name="risk" defaultValue={preset.risk ?? 'medium'}>
          {INCIDENT_RISKS.map((k) => <option key={k} value={k}>{t('platform.incidents.risks.' + k)}</option>)}
        </Select>
        <NumberField label={t('platform.incidents.fields.affectedCount')} name="affectedCount" min={0} step={1} optional defaultValue={preset.affectedCount ?? null} />
        <fieldset className="span-all">
          <legend className="lbl">{t('platform.incidents.fields.dataCategories')}</legend>
          <div className="grid-3" style={{ gap: 4 }}>
            {DATA_CATEGORIES.map((c) => <Checkbox key={c} name="dataCategories" value={c} defaultChecked={preset.dataCategories?.includes(c)} label={t('platform.incidents.categories.' + c)} />)}
          </div>
        </fieldset>
        <Textarea label={t('platform.incidents.fields.measures')} hint={t('platform.incidents.fields.measuresHint')} name="measures" rows={3} maxLength={5000} defaultValue={preset.measures ?? ''} optional wrapClassName="span-all" />
        <p className="small fg2 span-all" style={{ margin: 0 }}>{t('platform.incidents.hint72')}</p>
        <Select label={t('platform.incidents.fields.authorityRequired')} name="authorityRequired" defaultValue={tri(preset.authorityRequired)}>{triOptions}</Select>
        <DateTimeField label={t('platform.incidents.fields.authorityNotifiedAt')} name="authorityNotifiedAt" optional defaultValue={toDateTimeInput(preset.authorityNotifiedAt)} />
        <Select label={t('platform.incidents.fields.subjectsRequired')} name="subjectsRequired" defaultValue={tri(preset.subjectsRequired)}>{triOptions}</Select>
        <DateTimeField label={t('platform.incidents.fields.subjectsNotifiedAt')} name="subjectsNotifiedAt" optional defaultValue={toDateTimeInput(preset.subjectsNotifiedAt)} />
        <Select label={t('platform.incidents.fields.status')} name="status" defaultValue={preset.status ?? 'open'}>
          {INCIDENT_STATUS.map((k) => <option key={k} value={k}>{t('platform.incidents.status.' + k)}</option>)}
        </Select>
      </div>
    </>
  )
}

async function Incidents({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const now = new Date()
  const rows = await db.securityIncident.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ number: 'desc' }], take: 200 })
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.reportedById))] }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })
  const name = new Map(people.map((u) => [u.id, `${u.firstName} ${u.lastName}`]))
  return (
    <>
      <div className="row-between">
        <div>
          <h2 className="sec" style={{ margin: 0 }}>{t('platform.incidents.title')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t('platform.incidents.sub')}</p>
        </div>
        <FormDialog label={t('platform.incidents.create')} buttonClass="btn primary" title={t('platform.incidents.create')} action={saveIncidentAction} submit={t('platform.incidents.create')} success="platform.incidents.created" wide>
          <IncidentFields ctx={ctx} />
        </FormDialog>
      </div>
      {rows.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead>
              <tr>
                <th className="right">{t('platform.incidents.number')}</th><th>{t('platform.incidents.fields.title')}</th><th>{t('platform.incidents.fields.discoveredAt')}</th>
                <th>{t('platform.incidents.fields.risk')}</th><th>{t('platform.incidents.fields.authorityRequired')}</th><th>{t('platform.incidents.fields.status')}</th>
                <th><span className="sr-only">{t('admin.common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = deadlineState(r, now)
                return (
                  <tr key={r.id}>
                    <td className="num right">{r.number}</td>
                    <th scope="row" style={{ fontWeight: 500 }}>
                      {r.title}
                      <div className="small muted" style={{ fontWeight: 400 }}>
                        {t('platform.incidents.kindsShort.' + r.kind)}
                        {r.dataCategories.length > 0 && ' · ' + r.dataCategories.map((c) => t('platform.incidents.categories.' + c)).join(', ')}
                        {r.affectedCount != null && ` · ${r.affectedCount}`}
                      </div>
                      <div className="small muted" style={{ fontWeight: 400 }}>{t('platform.incidents.fields.reportedBy')}: {name.get(r.reportedById) ?? '–'}</div>
                    </th>
                    <td className="num nowrap">{dt(r.discoveredAt, ctx)}</td>
                    <td><span className={'tag' + (r.risk === 'high' ? ' crit' : r.risk === 'medium' ? ' warn' : '')}>{t('platform.incidents.risks.' + r.risk)}</span></td>
                    <td className="small">
                      {d.kind === 'none' && <span className="muted">{r.authorityRequired === false ? t('platform.incidents.notRequired') : '–'}</span>}
                      {d.kind === 'notified' && <span className="tag ok">✓ {t('platform.incidents.notified', { date: dt(d.at, ctx) })}</span>}
                      {d.kind === 'open' && <span className={'tag ' + (d.hoursLeft < 24 ? 'warn' : 'outline')}>{t('platform.incidents.deadline', { time: dt(d.due, ctx) })} · {t('platform.incidents.deadlineLeft', { h: d.hoursLeft })}</span>}
                      {d.kind === 'over' && <span className="tag crit">▲ {t('platform.incidents.deadlineOver')}</span>}
                    </td>
                    <td><span className={'tag' + (r.status === 'closed' ? ' ok' : r.status === 'open' ? ' warn' : '')}>{t('platform.incidents.status.' + r.status)}</span></td>
                    <td className="right">
                      <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={`${t('platform.incidents.number')} ${r.number} · ${r.title}`} action={saveIncidentAction} submit={t('common.save')} success="platform.incidents.saved" wide>
                        <IncidentFields ctx={ctx} preset={r} />
                      </FormDialog>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={t('platform.incidents.none')}>{t('platform.incidents.noneHint')}</Empty>
      )}
    </>
  )
}

async function System({ ctx }: { ctx: Ctx }) {
  const { t } = ctx
  const now = new Date()
  const [r, errors] = await Promise.all([
    healthReport(now),
    db.errorEvent.groupBy({ by: ['route', 'name', 'routeType'], where: { lastAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) } }, _sum: { count: true }, _max: { lastAt: true, digest: true }, orderBy: { _max: { lastAt: 'desc' } }, take: 50 }),
  ])
  const stateTag = (s: string) => <span className={'tag ' + (s === 'ok' ? 'ok' : s === 'off' || s === 'pending' || s === 'disabled' ? '' : s === 'degraded' || s === 'stale' ? 'warn' : 'crit')}>{s === 'ok' ? '✓ ' : s === 'off' || s === 'pending' || s === 'disabled' ? '' : '▲ '}{t('platform.system.state.' + s)}</span>
  const reportOnly = process.env.CSP_REPORT_ONLY === 'true'
  return (
    <>
      <section className="card" aria-labelledby="sys-components">
        <div className="card-head"><h2 id="sys-components">{t('platform.system.title')}</h2>{stateTag(r.status)}</div>
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="stable">
            <thead><tr><th>{t('platform.system.col.component')}</th><th>{t('platform.system.col.state')}</th><th>{t('platform.system.col.detail')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t('platform.system.components.db')}</th><td>{stateTag(r.db.state)}</td><td className="num">{r.db.ms != null ? t('platform.system.ms', { ms: r.db.ms }) : '–'}</td></tr>
              <tr><th scope="row">{t('platform.system.components.storage')}</th><td>{stateTag(r.storage?.state ?? 'off')}</td><td className="num">{r.storage?.ms != null ? t('platform.system.ms', { ms: r.storage.ms }) : r.storage?.error ?? '–'}</td></tr>
              <tr><th scope="row">{t('platform.system.components.realtime')}</th><td>{stateTag(r.realtime?.state ?? 'off')}</td><td>{t('platform.system.connections', { n: r.realtime?.connections ?? 0 })}</td></tr>
              <tr><th scope="row">{t('platform.system.components.push')}</th><td>{stateTag(r.push ?? 'off')}</td><td>–</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card-body small muted">{t('platform.system.uptime', { time: dt(new Date(now.getTime() - r.uptimeS * 1000), ctx) })}{process.env.RAILWAY_GIT_COMMIT_SHA ? ` · ${t('platform.system.version')} ${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)}` : ''}</div>
      </section>

      <section className="card" aria-labelledby="sys-jobs">
        <div className="card-head"><h2 id="sys-jobs">{t('platform.system.components.jobs')}</h2></div>
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="stable">
            <thead><tr><th>{t('platform.system.col.job')}</th><th>{t('platform.system.col.lastRun')}</th><th className="right">{t('platform.system.col.duration')}</th><th>{t('platform.system.col.state')}</th></tr></thead>
            <tbody>
              {r.jobs.map((j) => (
                <tr key={j.name}>
                  <th scope="row">{t('platform.system.jobs.' + j.name)}</th>
                  <td className="num nowrap">{j.lastStartedAt ? dt(j.lastStartedAt, ctx) : '–'}</td>
                  <td className="num right">{j.durationMs != null ? t('platform.system.ms', { ms: j.durationMs }) : '–'}</td>
                  <td>{stateTag(j.state)}{j.error && <div className="small muted" style={{ overflowWrap: 'anywhere' }}>{j.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="sys-errors">
        <div className="card-head"><h2 id="sys-errors">{t('platform.system.errorsTitle')}</h2></div>
        {errors.length ? (
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="stable">
              <thead><tr><th>{t('platform.system.col.route')}</th><th>{t('platform.system.col.name')}</th><th>{t('platform.system.col.type')}</th><th className="right">{t('platform.system.col.count')}</th><th>{t('platform.system.col.last')}</th></tr></thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.route + e.name + e.routeType}>
                    <td className="mono small" style={{ overflowWrap: 'anywhere' }}>{e.route}</td>
                    <td className="mono small">{e.name}{e._max.digest ? <div className="muted">{e._max.digest}</div> : null}</td>
                    <td>{t('platform.system.types.' + e.routeType)}</td>
                    <td className="num right">{e._sum.count ?? 0}</td>
                    <td className="num nowrap">{e._max.lastAt ? dt(e._max.lastAt, ctx) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card-body small muted">{t('platform.system.errorsNone')}</div>}
        <div className="card-body small muted" style={{ paddingTop: 0 }}>{t('platform.system.errorsHint')}</div>
      </section>

      <section className="card" aria-labelledby="sys-config">
        <div className="card-head"><h2 id="sys-config">{t('platform.system.config')}</h2></div>
        <div className="card-body">
          <dl className="kv">
            <dt>{t('platform.system.csp')}</dt><dd>{reportOnly ? <span className="tag warn">{t('platform.system.cspReport')}</span> : <span className="tag ok">✓ {t('platform.system.cspEnforce')}</span>}</dd>
            <dt>{t('platform.system.rateLimit')}</dt><dd>{t('platform.system.rateLimitValue')}</dd>
            <dt>{t('platform.system.metrics')}</dt><dd>{metricsToken() ? <code className="mono small">{t('platform.system.metricsOn')}</code> : <span className="muted">{t('platform.system.metricsOff')}</span>}</dd>
            <dt>{t('platform.system.errorHook')}</dt><dd>{process.env.ERROR_WEBHOOK_URL ? t('platform.system.errorHookOn') : <span className="muted">{t('platform.system.errorHookOff')}</span>}</dd>
          </dl>
        </div>
      </section>
    </>
  )
}
