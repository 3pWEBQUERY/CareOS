import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permissions'
import { Forbidden } from '@/components/ui/Empty'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../../Head'
import { PermissionMatrix } from '../Matrix'
import { deleteRoleAction, slimSysadminAction, updateRoleAction } from '../actions'
import { clinicalPermissions } from '@/lib/least-privilege'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const role = ctx.can('admin.roles') ? await db.role.findFirst({ where: { id: (await params).id, orgId: ctx.org.id }, select: { name: true } }) : null
  return { title: `${role ? role.name : t('admin.nav.roles')} · ${t('nav.admin')}` }
}

export default async function RoleDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.roles')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const role = await db.role.findFirst({
    where: { id, orgId: org.id },
    include: { assignments: { include: { user: { select: { id: true, firstName: true, lastName: true, active: true } }, unit: true, location: true }, orderBy: { user: { lastName: 'asc' } } } },
  })
  if (!role) notFound()
  const groups = PERMISSION_GROUPS.map((g) => ({ key: g.key, perms: ALL_PERMISSIONS.filter((p) => g.prefix.some((pre) => p.startsWith(pre))) }))
  return (
    <main className="panel main">
      <AdminHead section={'← ' + t('admin.nav.roles')} href="/admin/roles" title={role.name} sub={role.system ? t('admin.roles.systemHint') : t('admin.roles.customHint')}>
        {role.system ? <span className="tag outline">{t('admin.roles.system')}</span> : <ActBtn action={deleteRoleAction.bind(null, role.id)} className="btn danger" confirm="admin.roles.deleteConfirm" context={<span><strong>{role.name}</strong> · {t('admin.ux.holdersN', { n: role.assignments.length })}</span>} consequences={role.assignments.length ? [t('admin.ux.deleteRoleHolders', { names: role.assignments.slice(0, 5).map((a) => `${a.user.firstName} ${a.user.lastName}`).join(', ') + (role.assignments.length > 5 ? ' …' : '') })] : undefined} ack={role.assignments.length ? t('admin.ux.deleteRoleAck') : undefined}>{t('common.delete')}</ActBtn>}
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          {role.permissions.includes('admin.roles') && <div className="alert warn"><span className="grow">{t('admin.roles.adminWarning')}</span></div>}
          {role.key === 'sysadmin' && clinicalPermissions(role.permissions).length > 0 && (
            <div className="alert warn">
              <span className="grow">{t('tenancy.roles.sysadminClinical')}</span>
              <ActBtn action={slimSysadminAction.bind(null, role.id)} className="btn sm" confirm="tenancy.roles.sysadminResetConfirm" consequences={[t('tenancy.roles.sysadminResetHint')]} context={<span><strong>{role.name}</strong> · {t('admin.ux.holdersN', { n: role.assignments.length })}</span>}>{t('tenancy.roles.sysadminReset')}</ActBtn>
            </div>
          )}
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <PermissionMatrix roleId={role.id} name={role.name} description={role.description ?? ''} groups={groups} initial={role.permissions} action={updateRoleAction} />
            <section className="card" aria-labelledby="r-users">
              <div className="card-head"><h2 id="r-users">{t('admin.roles.holders')}</h2><span className="pill">{role.assignments.length}</span></div>
              {role.assignments.length ? (
                <ul className="list">
                  {role.assignments.map((a) => (
                    <li key={a.id}>
                      <Link className="li" href={`/admin/users/${a.user.id}`}>
                        <div className="grow"><div>{a.user.lastName} {a.user.firstName}</div><div className="small muted">{a.unit ? `${t('profile.roles.unit')}: ${a.unit.name}` : a.location ? `${t('profile.roles.location')}: ${a.location.name}` : t('profile.roles.org')}</div></div>
                        {!a.user.active && <span className="tag">{t('admin.users.inactive')}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <div className="card-body small muted">{t('admin.roles.noHolders')}</div>}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
