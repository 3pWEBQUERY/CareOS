import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ALL_PERMISSIONS } from '@/lib/permissions'
import { Forbidden } from '@/components/ui/Empty'
import { FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { createRoleAction } from './actions'

export const metadata = { title: 'Admin · Rollen' }

export default async function RolesPage() {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.roles')) return <Forbidden text={t('common.notAllowed')} />
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
      <div className="scroll">
        <div className="tabpanel">
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr><th>{t('admin.roles.name')}</th><th>{t('admin.roles.key')}</th><th>{t('admin.roles.type')}</th><th className="right">{t('admin.roles.permissionCount')}</th><th className="right">{t('admin.roles.userCount')}</th><th>{t('admin.roles.scopes')}</th></tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const active = r.assignments.filter((a) => a.user.active)
                  const users = new Set(active.map((a) => a.userId)).size
                  const scoped = active.filter((a) => a.unitId || a.locationId).length
                  return (
                    <tr key={r.id} className="clickable">
                      <th scope="row"><Link href={`/admin/roles/${r.id}`}>{r.name}</Link>{r.description && <div className="small muted">{r.description}</div>}</th>
                      <td><code className="mono small">{r.key}</code></td>
                      <td>{r.system ? <span className="tag outline">{t('admin.roles.system')}</span> : <span className="tag accent">{t('admin.roles.custom')}</span>}</td>
                      <td className="num right">{r.permissions.length}<span className="muted">/{ALL_PERMISSIONS.length}</span></td>
                      <td className="num right">{users ? <Link href={`/admin/users?role=${r.id}`}>{users}</Link> : 0}</td>
                      <td className="small muted">{active.length ? t('admin.roles.scopeSummary', { org: active.length - scoped, scoped }) : '–'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('admin.roles.hint')}</p>
        </div>
      </div>
    </main>
  )
}
