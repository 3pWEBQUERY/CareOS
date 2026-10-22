import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { deleteChannelAction, saveChannelAction } from './actions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.channels')} · ${t('nav.admin')}` }
}

const KINDS = ['company', 'location', 'unit', 'care', 'admin', 'events', 'offers', 'custom'] as const

export default async function ChannelsPage() {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.config')) return <Forbidden text={t('common.notAllowed')} />
  const [channels, locations, units, roles] = await Promise.all([
    db.channel.findMany({ where: { orgId: org.id }, include: { location: true, unit: true, _count: { select: { posts: true } } }, orderBy: [{ archived: 'asc' }, { name: 'asc' }] }),
    db.location.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
    db.unit.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
    db.role.findMany({ where: { orgId: org.id }, orderBy: { name: 'asc' } }),
  ])
  const roleName = new Map(roles.map((r) => [r.key, r.name]))
  const fields = (c?: (typeof channels)[number]) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="form-grid">
        <label className="fld"><span className="lbl">{t('admin.channels.name')}</span><input className="field" name="name" defaultValue={c?.name} required maxLength={80} /></label>
        <label className="fld">
          <span className="lbl">{t('admin.channels.kind')}</span>
          <select className="field" name="kind" defaultValue={c?.kind ?? 'custom'}>{KINDS.map((k) => <option key={k} value={k}>{t('admin.channels.kinds.' + k)}</option>)}</select>
        </label>
        <label className="fld">
          <span className="lbl">{t('admin.channels.scope')}</span>
          <select className="field" name="scope" defaultValue={c?.unitId ? 'unit:' + c.unitId : c?.locationId ? 'loc:' + c.locationId : 'org'}>
            <option value="org">{t('admin.channels.scopeOrg')}</option>
            <optgroup label={t('admin.structure.locations')}>{locations.map((l) => <option key={l.id} value={'loc:' + l.id}>{l.name}</option>)}</optgroup>
            <optgroup label={t('admin.structure.unitsTitle')}>{units.map((u) => <option key={u.id} value={'unit:' + u.id}>{u.name}</option>)}</optgroup>
          </select>
        </label>
        <label className="fld span-all"><span className="lbl">{t('admin.channels.description')}</span><input className="field" name="description" defaultValue={c?.description ?? ''} maxLength={300} /></label>
      </div>
      <fieldset>
        <legend className="lbl">{t('admin.channels.postRoles')}</legend>
        <p className="small muted" style={{ margin: '0 0 6px' }}>{t('admin.channels.postRolesHint')}</p>
        <div className="grid-3" style={{ gap: 2 }}>
          {roles.map((r) => <label key={r.id} className="check"><input type="checkbox" name="postRoles" value={r.key} defaultChecked={c?.postRoles.includes(r.key)} /><span className="small">{r.name}</span></label>)}
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" name="archived" defaultChecked={c?.archived} /><span>{t('admin.channels.archived')}</span></label>
    </>
  )
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.channels')} sub={t('admin.channels.sub')}>
        <FormDialog label={t('admin.channels.create')} buttonClass="btn primary" title={t('admin.channels.create')} action={saveChannelAction} submit={t('common.save')} success="common.saved" wide>{fields()}</FormDialog>
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          {channels.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead><tr><th>{t('admin.channels.name')}</th><th>{t('admin.channels.kind')}</th><th>{t('admin.channels.scope')}</th><th>{t('admin.channels.postRoles')}</th><th className="right">{t('admin.channels.posts')}</th><th>{t('admin.channels.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{c.name}{c.description && <div className="small muted">{c.description}</div>}</th>
                      <td><span className="tag outline">{t('admin.channels.kinds.' + c.kind)}</span></td>
                      <td className="small">{c.unit?.name ?? c.location?.name ?? t('admin.channels.scopeOrg')}</td>
                      <td className="small">{c.postRoles.length ? c.postRoles.map((k) => roleName.get(k) ?? k).join(', ') : <span className="muted">{t('admin.channels.allWithPermission')}</span>}</td>
                      <td className="num right">{c._count.posts}</td>
                      <td>{c.archived ? <span className="tag">{t('admin.channels.archived')}</span> : <span className="tag ok">{t('admin.config.active')}</span>}</td>
                      <td className="right nowrap">
                        <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={c.name} action={saveChannelAction} submit={t('common.save')} success="common.saved" wide>{fields(c)}</FormDialog>
                        {c._count.posts === 0 && <ActBtn action={deleteChannelAction.bind(null, c.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<strong>{c.name}</strong>}>{t('common.delete')}</ActBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('admin.channels.none')} />}
          <p className="small muted" style={{ margin: 0 }}>{t('admin.channels.moderationHint')}</p>
        </div>
      </div>
    </main>
  )
}
