import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { Forbidden } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn, SecretDialog } from '@/components/admin/ui'
import { AdminHead } from '../../Head'
import { UserFields } from '../fields'
import { auditLabel } from '../../audit-label'
import { ModeFields } from '../ModeFields'
import {
  addAssignmentAction, addUserQualificationAction, removeAssignmentAction, removeUserQualificationAction,
  resetMfaAction, resetPasswordAction, revokeUserSessionsAction, setUserActiveAction, updateUserAction,
} from '../actions'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const u = ctx.can('admin.users') ? await db.user.findFirst({ where: { id: (await params).id, orgId: ctx.org.id }, select: { firstName: true, lastName: true } }) : null
  return { title: `${u ? `${u.lastName} ${u.firstName}` : t('admin.nav.users')} · ${t('nav.admin')}` }
}

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, org, locale } = ctx
  if (!ctx.can('admin.users')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const user = await db.user.findFirst({
    where: { id, orgId: org.id },
    include: {
      roles: { include: { role: true, unit: true, location: true } },
      qualifications: { include: { qualification: true } },
      _count: { select: { passkeys: true } },
    },
  })
  if (!user) notFound()
  const now = new Date()
  const [units, locations, roles, quals, sessions, activity] = await Promise.all([
    db.unit.findMany({ where: { orgId: org.id }, include: { location: true }, orderBy: { name: 'asc' } }),
    db.location.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
    db.role.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
    db.qualification.findMany({ where: { orgId: org.id }, orderBy: [{ level: 'desc' }, { name: 'asc' }] }),
    db.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: now } } }),
    ctx.can('admin.audit') ? db.auditLog.findMany({ where: { orgId: org.id, OR: [{ userId: id }, { entityType: 'User', entityId: id }] }, orderBy: { at: 'desc' }, take: 10 }) : Promise.resolve([]),
  ])
  const self = user.id === ctx.user.id
  const dt = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const canRoles = ctx.can('admin.roles')
  const who = <span><strong>{user.firstName} {user.lastName}</strong> · {user.email}{user.roles.length ? ` · ${user.roles.map((r) => r.role.name).join(', ')}` : ''}</span>

  return (
    <main className="panel main">
      <AdminHead section={'← ' + t('admin.nav.users')} href="/admin/users" title={`${user.firstName} ${user.lastName}`} sub={[user.jobTitle, user.email].filter(Boolean).join(' · ')}>
        {user.active ? <span className="tag ok">{t('admin.users.active')}</span> : <span className="tag crit">{t('admin.users.inactive')}</span>}
        {!self && (
          <>
            <SecretDialog
              label={t('admin.users.resetPassword')}
              title={t('admin.users.resetPassword')}
              action={resetPasswordAction}
              submit={t('admin.users.resetPassword')}
              success="admin.users.passwordReset"
              intro={t('admin.users.resetOnce')}
              secretLabel={t('admin.users.resetLink')}
            >
              <input type="hidden" name="id" value={user.id} />
              <p className="fg2" style={{ margin: 0 }}>{t('admin.users.resetHint')}</p>
              <ModeFields linkLabel={t('admin.users.modeResetLink')} linkHint={t('admin.users.modeInviteHint')} />
            </SecretDialog>
            {user.mfaEnabled && <ActBtn action={resetMfaAction.bind(null, user.id)} className="btn" confirm="admin.users.mfaResetConfirm" context={who}>{t('admin.users.resetMfa')}</ActBtn>}
            {user.active
              ? <ActBtn action={setUserActiveAction.bind(null, user.id, false)} className="btn danger" confirm="admin.users.deactivateConfirm" context={who} consequences={[t('admin.ux.deactivateRoles', { n: user.roles.length }), t('admin.ux.deactivateUndo')]}>{t('admin.users.deactivate')}</ActBtn>
              : <ActBtn action={setUserActiveAction.bind(null, user.id, true)} className="btn">{t('admin.users.reactivate')}</ActBtn>}
          </>
        )}
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          {self && <div className="alert info"><span className="grow">{t('admin.users.selfHint')} <Link href="/profile">{t('nav.profile')}</Link></span></div>}
          <div className="grid-2">
            <section className="card" aria-labelledby="ud-master">
              <div className="card-head"><h2 id="ud-master">{t('admin.users.master')}</h2></div>
              <div className="card-body">
                <ActionForm action={updateUserAction} reset={false} success="common.saved">
                  <input type="hidden" name="id" value={user.id} />
                  <UserFields t={t} units={units} user={user} defaultLocale={org.defaultLocale} />
                  <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
                </ActionForm>
              </div>
            </section>

            <div className="stack">
              <section className="card" aria-labelledby="ud-sec">
                <div className="card-head">
                  <h2 id="ud-sec">{t('admin.users.security')}</h2>
                  {sessions > 0 && !self && <ActBtn action={revokeUserSessionsAction.bind(null, user.id)} className="btn sm" confirm="admin.users.revokeSessionsConfirm" context={who} consequences={[t('admin.ux.sessionsN', { n: sessions })]}>{t('admin.users.revokeSessions')}</ActBtn>}
                </div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('admin.users.mfa')}</dt><dd>{user.mfaEnabled ? <span className="tag ok">{t('admin.users.mfaOn')}</span> : <span className="tag warn">{t('admin.users.mfaOff')}</span>}</dd>
                    <dt>{t('admin.users.passkeys')}</dt><dd className="mono">{user._count.passkeys}</dd>
                    <dt>{t('admin.users.sessions')}</dt><dd className="mono">{sessions}</dd>
                    <dt>{t('admin.users.password')}</dt><dd>{user.passwordHash ? t('admin.users.passwordSet') : <span className="warn-text">{t('admin.users.passwordNone')}</span>}</dd>
                    <dt>{t('admin.users.lastLogin')}</dt><dd className="mono">{user.lastLoginAt ? dt(user.lastLoginAt) : t('admin.users.never')}</dd>
                    <dt>{t('admin.users.createdAt')}</dt><dd className="mono">{dt(user.createdAt)}</dd>
                  </dl>
                </div>
              </section>

              <section className="card" aria-labelledby="ud-roles">
                <div className="card-head"><h2 id="ud-roles">{t('admin.users.roles')}</h2>{!canRoles && <span className="small muted">{t('admin.users.escalationHint')}</span>}</div>
                {user.roles.length > 0 && (
                  <ul className="list">
                    {user.roles.map((a) => (
                      <li key={a.id}>
                        <div className="li" style={{ alignItems: 'center' }}>
                          <div className="grow">
                            <div>{canRoles ? <Link href={`/admin/roles/${a.roleId}`}>{a.role.name}</Link> : a.role.name}</div>
                            <div className="small muted">{a.unit ? `${t('profile.roles.unit')}: ${a.unit.name}` : a.location ? `${t('profile.roles.location')}: ${a.location.name}` : t('profile.roles.org')}</div>
                          </div>
                          <span className="pill" title={t('admin.roles.permissionCount')}>{a.role.permissions.length}</span>
                          <ActBtn action={removeAssignmentAction.bind(null, a.id)} className="btn sm ghost" confirm="admin.users.removeRoleConfirm" context={<span><strong>{user.firstName} {user.lastName}</strong> · {a.role.name} · {a.unit ? a.unit.name : a.location ? a.location.name : t('profile.roles.org')}</span>} consequences={[t('admin.ux.removeRoleEffect', { n: a.role.permissions.length })]} confirmLabel={t('admin.ux.removeRole')} success="admin.ux.roleRemoved">{t('admin.common.remove')}</ActBtn>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="card-foot">
                  <ActionForm action={addAssignmentAction} success="common.saved" className="row">
                    <input type="hidden" name="userId" value={user.id} />
                    <select className="field grow" name="roleId" required defaultValue="" aria-label={t('admin.users.role')} style={{ minWidth: 150 }}>
                      <option value="" disabled>{t('admin.users.role')}</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select className="field grow" name="scope" defaultValue={user.primaryUnitId ? 'unit:' + user.primaryUnitId : 'org'} aria-label={t('admin.users.scope')} style={{ minWidth: 150 }}>
                      <option value="org">{t('admin.users.scopeOrg')}</option>
                      <optgroup label={t('admin.structure.locations')}>{locations.map((l) => <option key={l.id} value={'loc:' + l.id}>{l.name}</option>)}</optgroup>
                      <optgroup label={t('admin.structure.unitsTitle')}>{units.map((u) => <option key={u.id} value={'unit:' + u.id}>{u.name}</option>)}</optgroup>
                    </select>
                    <Submit className="btn">{t('admin.users.assign')}</Submit>
                  </ActionForm>
                </div>
              </section>

              <section className="card" aria-labelledby="ud-quals">
                <div className="card-head"><h2 id="ud-quals">{t('profile.qualifications.title')}</h2></div>
                {user.qualifications.length > 0 && (
                  <ul className="list">
                    {user.qualifications.map((q) => {
                      const expired = q.validUntil && q.validUntil < now
                      return (
                        <li key={q.qualificationId}>
                          <div className="li" style={{ alignItems: 'center' }}>
                            <div className="grow"><div>{q.qualification.name}</div><div className="small muted">{t('profile.qualifications.level', { n: q.qualification.level })}</div></div>
                            {q.validUntil && <span className={'tag' + (expired ? ' crit' : '')}>{t(expired ? 'profile.qualifications.expired' : 'profile.qualifications.validUntil', { date: fmtDate(q.validUntil, locale) })}</span>}
                            <ActBtn action={removeUserQualificationAction.bind(null, user.id, q.qualificationId)} className="btn sm ghost">{t('admin.common.remove')}</ActBtn>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="card-foot">
                  <ActionForm action={addUserQualificationAction} success="common.saved" className="row">
                    <input type="hidden" name="userId" value={user.id} />
                    <select className="field grow" name="qualificationId" required defaultValue="" aria-label={t('profile.qualifications.title')} style={{ minWidth: 150 }}>
                      <option value="" disabled>{t('admin.users.pickQualificationLabel')}</option>
                      {quals.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                    <input className="field" type="date" name="validUntil" aria-label={t('admin.users.validUntil')} title={t('admin.users.validUntil')} style={{ width: 160 }} />
                    <Submit className="btn">{t('common.add')}</Submit>
                  </ActionForm>
                </div>
              </section>
            </div>
          </div>

          {activity.length > 0 && (
            <section className="stack-sm" aria-labelledby="ud-act">
              <div className="sec-head"><h2 className="sec" id="ud-act">{t('admin.users.activity')}</h2><Link className="linkbtn small" href={`/admin/audit?user=${user.id}`}>{t('admin.overview.allAudit')}</Link></div>
              <div className="tablewrap">
                <table className="stable">
                  <thead><tr><th>{t('admin.audit.at')}</th><th>{t('admin.audit.action')}</th><th>{t('admin.audit.entity')}</th><th>{t('admin.audit.ip')}</th></tr></thead>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={String(a.id)}><td className="num nowrap">{rel(a.at)}</td><td className="small">{auditLabel(t, a.action) ?? <span className="mono">{a.action}</span>}</td><td className="small">{a.entityType}</td><td className="num">{a.ip ?? '–'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
