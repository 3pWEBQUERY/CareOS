import Link from 'next/link'
import { db } from '@/lib/db'
import { fmtDate } from '@/lib/time'
import { DATA_REGIONS } from '@/lib/admin-shared'
import { MODULES } from '@/lib/modules'
import { fmtBytes } from '@/lib/platform-core'
import { orgStats } from '@/lib/platform'
import { orgSignupEnabled } from '@/lib/registration'
import { Empty } from '@/components/ui/Empty'
import { ActBtn, SecretForm } from '@/components/admin/ui'
import { Checkbox, NumberField, Select, TextField } from '@/components/ui/fields'
import { platformAccess } from './access'
import { approveOrgAction, createOrgAction, suspendOrgAction } from './actions'
import { SuspendButton } from './SuspendButton'
import { StatusTag } from './StatusTag'

export async function generateMetadata() {
  const { ctx } = await platformAccess()
  return { title: ctx.t('tenancy.platform.title') }
}

const TABS = ['orgs', 'requests', 'create', 'audit'] as const
type Tab = (typeof TABS)[number]

/** Plattform-Übersicht (PRD §42, §64 «aktive Einrichtungen»): nur Zählwerte, keine Personen- oder Gesundheitsdaten. */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx, ok, mfa } = await platformAccess()
  if (!ok || !mfa) return null // Layout zeigt den Hinweis
  const { t, locale } = ctx
  const sp = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'orgs'
  const orgs = await orgStats()
  const pending = orgs.filter((o) => o.status === 'pending')
  const n = { all: orgs.length, active: orgs.filter((o) => o.status === 'active').length, pending: pending.length, suspended: orgs.filter((o) => o.status === 'suspended').length, users7: orgs.reduce((s, o) => s + o.active7, 0) }
  const date = (d: Date) => fmtDate(d, locale)

  return (
    <main className="panel main">
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <div className="lbl">{t('tenancy.platform.section')}</div>
          <h1>{t('tenancy.platform.title')}</h1>
          <p className="sub">{t('tenancy.platform.sub')}</p>
        </div>
      </div>
      <nav className="tabs" aria-label={t('tenancy.platform.title')}>
        {TABS.map((k) => (
          <Link key={k} href={`/platform?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>
            {t('tenancy.platform.nav.' + k)}{k === 'requests' && pending.length ? <span className="pill" aria-hidden="true">{pending.length}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'orgs' && (
            <>
              <div className="metrics">
                <div className="metric"><span className="lbl">{t('tenancy.platform.metrics.orgs')}</span><span className="val">{n.all}</span></div>
                <div className="metric"><span className="lbl">{t('tenancy.platform.metrics.active')}</span><span className="val">{n.active}</span></div>
                <div className="metric"><span className="lbl">{t('tenancy.platform.metrics.pending')}</span><span className="val">{n.pending}</span></div>
                <div className="metric"><span className="lbl">{t('tenancy.platform.metrics.suspended')}</span><span className="val">{n.suspended}</span></div>
                <div className="metric"><span className="lbl">{t('tenancy.platform.metrics.users7')}</span><span className="val">{n.users7}</span></div>
              </div>
              {orgs.length ? (
                <div className="tablewrap">
                  <table className="stable">
                    <thead>
                      <tr>
                        <th>{t('tenancy.platform.col.name')}</th><th>{t('tenancy.platform.col.status')}</th>
                        <th className="right">{t('tenancy.platform.col.users')}</th><th className="right">{t('tenancy.platform.col.residents')}</th>
                        <th className="right">{t('tenancy.platform.col.active7')}</th><th className="right">{t('tenancy.platform.col.active30')}</th>
                        <th className="right">{t('tenancy.platform.col.storage')}</th><th className="right">{t('tenancy.platform.col.modules')}</th><th>{t('tenancy.platform.col.created')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgs.map((o) => (
                        <tr key={o.id}>
                          <th scope="row"><Link href={`/platform/orgs/${o.id}`}>{o.name}</Link>{o.id === ctx.org.id && <div className="small muted">{t('tenancy.platform.operator')}</div>}</th>
                          <td><StatusTag status={o.status} t={t} /></td>
                          <td className="num right">{o.users}</td>
                          <td className="num right">{o.residents}</td>
                          <td className="num right">{o.active7}</td>
                          <td className="num right">{o.active30}</td>
                          <td className="num right nowrap">{fmtBytes(o.storage)}</td>
                          <td className="num right">{o.modules.length}<span className="muted">/{MODULES.length}</span></td>
                          <td className="num nowrap">{date(o.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty title={t('tenancy.platform.none')} />}
            </>
          )}
          {tab === 'requests' && <Requests pending={pending} />}
          {tab === 'create' && (
            <section className="card" aria-labelledby="pl-create">
              <div className="card-head"><h2 id="pl-create">{t('tenancy.platform.create.title')}</h2></div>
              <div className="card-body stack-sm">
                <p className="fg2" style={{ margin: 0, maxWidth: '75ch' }}>{t('tenancy.platform.create.hint')}</p>
                <SecretForm action={createOrgAction} submit={t('tenancy.platform.create.submit')} intro={t('tenancy.platform.create.inviteHint')} label={t('tenancy.platform.create.invite')} success="tenancy.platform.create.done">
                  <TextField label={t('tenancy.platform.create.orgName')} name="orgName" required minLength={2} maxLength={120} />
                  <div className="form-grid">
                    <TextField label={t('tenancy.platform.create.location')} name="locationName" maxLength={120} optional />
                    <Select label={t('tenancy.platform.create.region')} name="dataRegion" defaultValue="ch-zurich">
                      {DATA_REGIONS.map((r) => <option key={r} value={r}>{t('admin.org.regions.' + r.replace('-', '_'))}</option>)}
                    </Select>
                    <NumberField label={t('tenancy.platform.create.units')} name="units" defaultValue={1} min={1} max={50} step={1} required />
                    <TextField label={t('tenancy.platform.create.unitName')} hint={t('tenancy.platform.create.unitNameHint')} name="unitName" maxLength={60} optional />
                  </div>
                  <div className="form-grid">
                    <TextField label={t('tenancy.platform.create.adminFirst')} name="adminFirst" required maxLength={60} autoComplete="off" />
                    <TextField label={t('tenancy.platform.create.adminLast')} name="adminLast" required maxLength={60} autoComplete="off" />
                    <TextField label={t('tenancy.platform.create.adminEmail')} name="adminEmail" type="email" required maxLength={160} autoComplete="off" />
                  </div>
                  <fieldset>
                    <legend className="lbl">{t('tenancy.platform.modules')}</legend>
                    <div className="grid-3" style={{ gap: 4 }}>
                      {MODULES.map((m) => <Checkbox key={m.key} name={'module:' + m.key} defaultChecked label={t('tenancy.modules.items.' + m.key + '.name')} />)}
                    </div>
                  </fieldset>
                </SecretForm>
              </div>
            </section>
          )}
          {tab === 'audit' && <PlatformAudit />}
        </div>
      </div>
    </main>
  )

  async function Requests({ pending }: { pending: typeof orgs }) {
    if (!pending.length) return <Empty title={t('tenancy.platform.noRequests')}>{orgSignupEnabled() ? t('tenancy.platform.noRequestsHint') : t('tenancy.platform.signupOff')}</Empty>
    // Beantragende Person = erste Systemadministration der Organisation (nur Name und E-Mail, für die Prüfung)
    const admins = await db.user.findMany({
      where: { orgId: { in: pending.map((o) => o.id) }, roles: { some: { role: { key: 'sysadmin' } } } },
      select: { orgId: true, firstName: true, lastName: true, email: true }, orderBy: { createdAt: 'asc' },
    })
    return (
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
        {pending.map((o) => {
          const a = admins.find((x) => x.orgId === o.id)
          return (
            <li key={o.id}>
              <div className="li" style={{ flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 220 }}>
                  <div><strong>{o.name}</strong> <span className="small muted mono">{date(o.createdAt)}</span></div>
                  {a && <div className="small muted">{t('tenancy.platform.requestedBy', { name: `${a.firstName} ${a.lastName}`, email: a.email })}</div>}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <ActBtn action={approveOrgAction.bind(null, o.id)} className="btn sm primary" confirm="tenancy.platform.approveConfirm" consequences={[t('tenancy.platform.approveHint')]} context={<strong>{o.name}</strong>}>{t('tenancy.platform.approve')}</ActBtn>
                  <SuspendButton id={o.id} name={o.name} label={t('tenancy.platform.reject')} action={suspendOrgAction} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  async function PlatformAudit() {
    const rows = await db.auditLog.findMany({ where: { action: { startsWith: 'platform.' }, context: { path: ['platform'], equals: true } }, orderBy: { at: 'desc' }, take: 100 })
    // Jede Aktion steht im Protokoll der Ziel- und der eigenen Organisation – hier nur einmal (Zielorganisation)
    const list = rows.filter((r) => r.orgId === r.entityId)
    if (!list.length) return <Empty title={t('tenancy.platform.auditNone')} />
    const [people, orgNames] = await Promise.all([
      db.user.findMany({ where: { id: { in: [...new Set(list.map((r) => r.userId).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, lastName: true } }),
      db.organization.findMany({ where: { id: { in: [...new Set(list.map((r) => r.entityId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
    ])
    const dtm = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    return (
      <div className="tablewrap">
        <table className="stable">
          <thead><tr><th>{t('tenancy.platform.auditCol.at')}</th><th>{t('tenancy.platform.auditCol.who')}</th><th>{t('tenancy.platform.auditCol.action')}</th><th>{t('tenancy.platform.auditCol.org')}</th></tr></thead>
          <tbody>
            {list.map((r) => {
              const p = people.find((u) => u.id === r.userId)
              return (
                <tr key={String(r.id)}>
                  <td className="num nowrap">{dtm(r.at)}</td>
                  <td>{p ? `${p.firstName} ${p.lastName}` : '–'}</td>
                  <td>{t('tenancy.platform.actions.' + r.action.replace(/^platform\./, '').replace(/\./g, '_'))}</td>
                  <td>{orgNames.find((o) => o.id === r.entityId)?.name ?? '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
}

