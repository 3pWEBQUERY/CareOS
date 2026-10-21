import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtRel } from '@/lib/time'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn, SecretDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { UserFields } from './fields'
import { ModeFields } from './ModeFields'
import { createUserAction, deleteQualificationAction, saveQualificationAction } from './actions'

export const metadata = { title: 'Admin · Benutzer' }

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; role?: string }> }) {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.users')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const status = sp.status === 'inactive' ? 'inactive' : sp.status === 'all' ? 'all' : 'active'
  const where: Prisma.UserWhereInput = {
    orgId: org.id,
    ...(status === 'all' ? {} : { active: status === 'active' }),
    ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { employeeNo: { contains: q, mode: 'insensitive' } }, { jobTitle: { contains: q, mode: 'insensitive' } }] } : {}),
    ...(sp.role ? { roles: { some: { roleId: sp.role } } } : {}),
  }
  const [users, units, roles, quals] = await Promise.all([
    db.user.findMany({ where, include: { roles: { include: { role: true, unit: true, location: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 300 }),
    db.unit.findMany({ where: { orgId: org.id }, include: { location: true }, orderBy: { name: 'asc' } }),
    db.role.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
    db.qualification.findMany({ where: { orgId: org.id }, include: { _count: { select: { users: true } } }, orderBy: [{ level: 'desc' }, { name: 'asc' }] }),
  ])
  const unitName = new Map(units.map((u) => [u.id, u.name]))
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const qs = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams()
    const m = { q: q || undefined, status: status === 'active' ? undefined : status, role: sp.role, ...p }
    for (const [k, v] of Object.entries(m)) if (v) s.set(k, v)
    const str = s.toString()
    return '/admin/users' + (str ? '?' + str : '')
  }

  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.users')} sub={t('admin.users.sub')}>
        <SecretDialog
          label={t('admin.users.create')}
          buttonClass="btn primary"
          title={t('admin.users.create')}
          action={createUserAction}
          submit={t('common.create')}
          success="admin.users.created"
          intro={t('admin.users.inviteOnce')}
          secretLabel={t('admin.users.inviteLink')}
        >
          <UserFields t={t} units={units} defaultLocale={org.defaultLocale} />
          <div className="form-grid">
            <label className="fld">
              <span className="lbl">{t('admin.users.initialRole')}</span>
              <select className="field" name="roleId" defaultValue="">
                <option value="">{t('admin.users.noRole')}</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="fld">
              <span className="lbl">{t('admin.users.scope')}</span>
              <select className="field" name="roleScope" defaultValue="unit">
                <option value="unit">{t('admin.users.scopePrimaryUnit')}</option>
                <option value="org">{t('admin.users.scopeOrg')}</option>
              </select>
            </label>
          </div>
          <ModeFields linkLabel={t('admin.users.modeInvite')} linkHint={t('admin.users.modeInviteHint')} />
        </SecretDialog>
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          <form className="row" role="search" action="/admin/users">
            <input className="field grow" type="search" name="q" defaultValue={q} placeholder={t('admin.users.search')} aria-label={t('admin.users.search')} style={{ minWidth: 200 }} />
            {status !== 'active' && <input type="hidden" name="status" value={status} />}
            {sp.role && <input type="hidden" name="role" value={sp.role} />}
            <button className="btn" type="submit">{t('common.search')}</button>
          </form>
          <div className="row-between">
            <div className="seg" role="group" aria-label={t('admin.users.status')}>
              {(['active', 'inactive', 'all'] as const).map((s) => (
                <Link key={s} href={qs({ status: s === 'active' ? undefined : s })} aria-current={status === s ? 'page' : undefined}>{t('admin.users.statusFilter.' + s)}</Link>
              ))}
            </div>
            <div className="row">
              {sp.role && <Link className="chip" aria-current="page" href={qs({ role: undefined })}>{roles.find((r) => r.id === sp.role)?.name} ✕</Link>}
              <span className="small muted">{t('admin.users.count', { n: users.length })}</span>
            </div>
          </div>
          {users.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr><th>{t('admin.users.name')}</th><th>{t('admin.users.jobTitle')}</th><th>{t('admin.users.primaryUnit')}</th><th>{t('admin.users.roles')}</th><th>{t('admin.users.mfa')}</th><th>{t('admin.users.lastLogin')}</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="clickable">
                      <th scope="row">
                        <Link href={`/admin/users/${u.id}`} className="row" style={{ gap: 8, flexWrap: 'nowrap', textDecoration: 'none', color: 'inherit' }}>
                          <span className={'av sm' + (u.active ? '' : ' muted')} aria-hidden="true">{u.initials}</span>
                          <span style={{ minWidth: 0 }}><span className="linkbtn">{u.lastName} {u.firstName}</span>{!u.active && <> <span className="tag crit">{t('admin.users.inactive')}</span></>}<br /><span className="small muted">{u.email}</span></span>
                        </Link>
                      </th>
                      <td>{u.jobTitle ?? '–'}</td>
                      <td className="nowrap">{u.primaryUnitId ? unitName.get(u.primaryUnitId) ?? '–' : '–'}</td>
                      <td><div className="chips">{u.roles.map((a) => <span key={a.id} className="tag outline" title={a.unit?.name ?? a.location?.name ?? t('admin.users.scopeOrg')}>{a.role.name}{a.unit ? ` · ${a.unit.shortName ?? a.unit.name}` : a.location ? ` · ${a.location.name}` : ''}</span>)}</div></td>
                      <td>{u.mfaEnabled ? <span className="tag ok">{t('admin.users.mfaOn')}</span> : <span className="tag">{t('admin.users.mfaOff')}</span>}</td>
                      <td className="num nowrap">{u.lastLoginAt ? rel(u.lastLoginAt) : <span className="muted">{t('admin.users.never')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('admin.users.none')} />}

          <section className="card" aria-labelledby="u-quals">
            <div className="card-head"><h2 id="u-quals">{t('admin.users.qualCatalog')}</h2><span className="small muted">{t('admin.users.qualCatalogHint')}</span></div>
            <ul className="list">
              {quals.map((ql) => (
                <li key={ql.id}>
                  <div className="li" style={{ alignItems: 'center' }}>
                    <div className="grow"><div>{ql.name}</div><div className="small muted">{t('profile.qualifications.level', { n: ql.level })} · {t('admin.users.holders', { n: ql._count.users })}</div></div>
                    {ql._count.users === 0 && <ActBtn action={deleteQualificationAction.bind(null, ql.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm">{t('common.delete')}</ActBtn>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="card-foot">
              <ActionForm action={saveQualificationAction} success="common.saved" className="row">
                <input className="field grow" name="name" placeholder={t('admin.users.qualName')} aria-label={t('admin.users.qualName')} required maxLength={80} style={{ minWidth: 180 }} />
                <select className="field" name="level" defaultValue="2" aria-label={t('admin.users.qualLevel')} style={{ width: 120 }}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{t('profile.qualifications.level', { n })}</option>)}
                </select>
                <Submit className="btn">{t('common.add')}</Submit>
              </ActionForm>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
