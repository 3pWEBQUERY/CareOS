import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { addDays, fmtRel } from '@/lib/time'
import { countOrgAdmins } from '@/lib/admin'
import { ADMIN_SECTIONS } from './sections'
import { auditLabel } from './audit-label'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('admin.title') }
}

export default async function AdminHome() {
  const ctx = await getCtx()
  const { t, org } = ctx
  const now = new Date()
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.perm) || (!!s.alsoPerm && ctx.can(s.alsoPerm)))
  const [users, inactive, noMfa, roles, units, residents, audit24, tokens, hooks, failed, admins, recent, forms, channels, locations] = await Promise.all([
    db.user.count({ where: { orgId: org.id, active: true } }),
    db.user.count({ where: { orgId: org.id, active: false } }),
    db.user.count({ where: { orgId: org.id, active: true, mfaEnabled: false } }),
    db.role.count({ where: { orgId: org.id } }),
    db.unit.count({ where: { orgId: org.id } }),
    db.resident.count({ where: { orgId: org.id, status: { in: ['active', 'absent'] } } }),
    db.auditLog.count({ where: { orgId: org.id, at: { gte: addDays(now, -1) } } }),
    db.apiToken.count({ where: { orgId: org.id, revokedAt: null } }),
    db.webhook.count({ where: { orgId: org.id, active: true } }),
    db.auditLog.count({ where: { orgId: org.id, action: { in: ['auth.login_failed', 'auth.mfa_failed'] }, at: { gte: addDays(now, -1) } } }),
    countOrgAdmins(db, org.id),
    ctx.can('admin.audit')
      ? db.auditLog.findMany({ where: { orgId: org.id, OR: [{ action: { startsWith: 'admin.' } }, { action: { startsWith: 'auth.' } }, { action: { startsWith: 'api.' } }] }, orderBy: { at: 'desc' }, take: 8 })
      : Promise.resolve([]),
    db.formDefinition.count({ where: { orgId: org.id, active: true } }),
    db.channel.count({ where: { orgId: org.id } }),
    db.location.count({ where: { orgId: org.id } }),
  ])
  // Kurzer Stand je Bereich (Information vor Navigation, PRD §4.3)
  const fact: Record<string, string | undefined> = {
    org: org.name,
    structure: t('admin.ux.factStructure', { loc: locations, units, res: residents }),
    users: t('admin.ux.factUsers', { n: users, mfa: noMfa }),
    roles: t('admin.overview.roles', { n: roles }),
    forms: t('admin.ux.factForms', { n: forms }),
    channels: t('admin.ux.factChannels', { n: channels }),
    audit: t('admin.ux.factAudit', { n: audit24 }),
    integrations: `${tokens} ${t('admin.overview.tokens')} · ${hooks} ${t('admin.overview.webhooks')}`,
  }
  const warnFact: Record<string, boolean> = { users: noMfa > 0, audit: failed > 0 }
  const people = await db.user.findMany({ where: { id: { in: recent.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })
  const who = (id: string | null) => {
    const p = people.find((u) => u.id === id)
    return p ? `${p.firstName} ${p.lastName}` : t('admin.audit.system')
  }
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)

  return (
    <main className="panel main">
      <div className="view-head">
        <div>
          <span className="lbl">{org.name}</span>
          <h1>{t('admin.title')}</h1>
          <p className="sub">{t('admin.overview.sub')}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics">
            <Link className="metric" href={ctx.can('admin.users') ? '/admin/users' : '/admin'}>
              <span className="lbl">{t('admin.overview.users')}</span>
              <span className="val">{users}{inactive > 0 && <small> · {t('admin.overview.inactive', { n: inactive })}</small>}</span>
            </Link>
            <div className="metric">
              <span className="lbl">{t('admin.overview.noMfa')}</span>
              <span className={'val' + (noMfa ? ' warn' : '')}>{noMfa}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('admin.ux.admins')}</span>
              <span className={'val' + (admins < 2 ? ' warn' : '')}>{admins}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('admin.overview.audit24')}</span>
              <span className="val">{audit24}{failed > 0 && <small className="crit-text"> · {t('admin.overview.failedLogins', { n: failed })}</small>}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('admin.overview.api')}</span>
              <span className="val">{tokens}<small> {t('admin.overview.tokens')} · {hooks} {t('admin.overview.webhooks')}</small></span>
            </div>
          </div>
          {admins < 2 && <div className="alert warn"><span className="grow">{t('admin.overview.singleAdmin')}</span></div>}

          <div className="grid-2">
            <section className="card" aria-labelledby="adm-sections">
              <div className="card-head"><h2 id="adm-sections">{t('admin.overview.sections')}</h2><span className="small muted">{t('admin.overview.structureLine', { units, res: residents, roles })}</span></div>
              <ul className="list">
                {sections.map((s) => (
                  <li key={s.key}>
                    <Link className="li" href={s.href}>
                      <div className="grow"><div>{t('admin.nav.' + s.key)}</div><div className="small muted">{t('admin.nav.' + s.key + 'Hint')}</div></div>
                      {fact[s.key] && <span className={'small nowrap adm-fact' + (warnFact[s.key] ? ' warn-text' : ' muted')}>{fact[s.key]}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            {ctx.can('admin.audit') && (
              <section className="card" aria-labelledby="adm-recent">
                <div className="card-head"><h2 id="adm-recent">{t('admin.overview.recent')}</h2><Link className="linkbtn small" href="/admin/audit">{t('admin.overview.allAudit')}</Link></div>
                {recent.length ? (
                  <ul className="list">
                    {recent.map((r) => (
                      <li key={String(r.id)}>
                        <div className="li">
                          <span className="mono small muted" style={{ minWidth: 96, flex: 'none' }}>{rel(r.at)}</span>
                          <div className="grow"><div className="small">{auditLabel(t, r.action) ?? <span className="mono">{r.action}</span>}</div><div className="small muted">{who(r.userId)}</div></div>
                          {(r.action.endsWith('_failed') || r.action.includes('failed')) && <span className="tag crit">{t('admin.audit.failed')}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('admin.audit.empty')}</div>}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
