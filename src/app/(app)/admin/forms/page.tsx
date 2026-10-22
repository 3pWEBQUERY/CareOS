import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtRel } from '@/lib/time'
import { readFields } from '@/lib/forms'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { setFormActiveAction } from './actions'
import { formUsage } from './usage'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.forms')} · ${t('nav.admin')}` }
}

const TONE: Record<string, string> = { care: 'accent', observation: 'warn', physician: 'violet', relatives: '', incident: 'crit', handover: 'ok' }

/** Admin → Formulare (PRD §45 Klinische Konfiguration): strukturierte Formulare für die Fokusdokumentation. */
export default async function FormsPage() {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.config')) return <Forbidden text={t('common.notAllowed')} />
  const defs = await db.formDefinition.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
  const usage = await formUsage(ctx.org.id, defs.map((d) => d.key))
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.forms')} sub={t('forms.admin.sub')}>
        <Link className="btn primary" href="/admin/forms/new">{t('forms.admin.new')}</Link>
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('forms.admin.hint')}</p>
          {defs.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr>
                    <th>{t('admin.config.name')}</th>
                    <th>{t('forms.admin.category')}</th>
                    <th className="right">{t('forms.admin.fields')}</th>
                    <th className="right">{t('forms.admin.version')}</th>
                    <th className="right hide-sm">{t('forms.admin.entries')}</th>
                    <th className="hide-sm">{t('forms.admin.updated')}</th>
                    <th>{t('admin.config.status')}</th>
                    <th><span className="sr-only">{t('admin.common.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {defs.map((d) => (
                    <tr key={d.id}>
                      <th scope="row">
                        <Link href={`/admin/forms/${d.id}`} style={{ color: 'inherit' }}>{d.name}</Link>
                        <div className="small muted"><code className="mono">{d.key}</code></div>
                      </th>
                      <td><span className={'tag ' + (TONE[d.category] ?? '')}>{t('chart.cat.' + d.category)}</span></td>
                      <td className="num right">{readFields(d.fields).length}</td>
                      <td className="num right">v{d.version}</td>
                      <td className="num right hide-sm">{usage.get(d.key) ?? 0}</td>
                      <td className="small muted hide-sm nowrap">{rel(d.updatedAt)}</td>
                      <td>{d.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}</td>
                      <td className="right nowrap">
                        <Link className="btn sm ghost" href={`/admin/forms/${d.id}`}>{t('common.edit')}</Link>
                        <ActBtn action={setFormActiveAction.bind(null, d.id, !d.active)} className="btn sm ghost">{t(d.active ? 'forms.admin.deactivate' : 'forms.admin.activate')}</ActBtn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={t('forms.admin.none')} action={<Link className="btn" href="/admin/forms/new">{t('forms.admin.new')}</Link>} />
          )}
        </div>
      </div>
    </main>
  )
}
