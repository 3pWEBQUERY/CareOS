import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '@/lib/permissions'
import { Forbidden } from '@/components/ui/Empty'
import { FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { createRoleAction } from './actions'
import { RoleMatrix } from './RoleMatrix'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.roles')} · ${t('nav.admin')}` }
}

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.roles')) return <Forbidden text={t('common.notAllowed')} />
  const view = (await searchParams).view === 'matrix' ? 'matrix' : 'list'
  const roles = await db.role.findMany({ where: { orgId: org.id }, include: { assignments: { select: { userId: true, unitId: true, locationId: true, user: { select: { active: true } } } } }, orderBy: [{ system: 'desc' }, { name: 'asc' }] })
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.roles')} sub={t('admin.roles.sub')}>
        <FormDialog label={t('admin.roles.create')} buttonClass="btn primary" title={t('admin.roles.create')} action={createRoleAction} submit={t('common.create')}>
          <div className="form-grid">
            <label className="fld span-all"><span className="lbl">{t('admin.roles.name')}</span><input className="field" name="name" required maxLength={80} autoFocus /></label>
            <label className="fld span-all"><span className="lbl">{t('admin.roles.description')}</span><input className="field" name="description" maxLength={300} /></label>
            <label className="fld span-all">
              <span className="lbl">{t('admin.roles.copyFrom')}</span>
              <select className="field" name="copyFrom" defaultValue="">
                <option value="">{t('admin.roles.empty')}</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
        </FormDialog>
      </AdminHead>
      <nav className="tabs" aria-label={t('admin.nav.roles')}>
        <Link href="/admin/roles" aria-current={view === 'list' ? 'page' : undefined}>{t('admin.ux.rolesList')}</Link>
        <Link href="/admin/roles?view=matrix" aria-current={view === 'matrix' ? 'page' : undefined}>{t('admin.ux.matrixTitle')}</Link>
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {view === 'matrix' ? (
            <RoleMatrix
              roles={roles.map((r) => ({ id: r.id, name: r.name, system: r.system, permissions: [...r.permissions] }))}
              groups={PERMISSION_GROUPS.map((g) => ({ key: g.key, perms: ALL_PERMISSIONS.filter((p) => g.prefix.some((pre) => p.startsWith(pre))) }))}
            />
          ) : (
          <>
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr><th>{t('admin.roles.name')}</th><th className="hide-sm">{t('admin.roles.key')}</th><th>{t('admin.roles.type')}</th><th className="right">{t('admin.roles.permissionCount')}</th><th className="right">{t('admin.roles.userCount')}</th><th className="hide-sm">{t('admin.roles.scopes')}</th></tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const active = r.assignments.filter((a) => a.user.active)
                  const users = new Set(active.map((a) => a.userId)).size
                  const scoped = active.filter((a) => a.unitId || a.locationId).length
                  return (
                    <tr key={r.id} className="clickable">
                      <th scope="row"><Link href={`/admin/roles/${r.id}`}>{r.name}</Link>{r.description && <div className="small muted">{r.description}</div>}</th>
                      <td className="hide-sm"><code className="mono small">{r.key}</code></td>
                      <td>{r.system ? <span className="tag outline">{t('admin.roles.system')}</span> : <span className="tag accent">{t('admin.roles.custom')}</span>}</td>
                      <td className="num right">{r.permissions.length}<span className="muted">/{ALL_PERMISSIONS.length}</span></td>
                      <td className="num right">{users ? <Link href={`/admin/users?role=${r.id}`}>{users}</Link> : 0}</td>
                      <td className="small muted hide-sm">{active.length ? t('admin.roles.scopeSummary', { org: active.length - scoped, scoped }) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('admin.roles.hint')}</p>
          </>
          )}
        </div>
      </div>
    </main>
  )
}
