import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { readFields } from '@/lib/forms'
import { Forbidden } from '@/components/ui/Empty'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../../Head'
import { deleteFormAction } from '../actions'
import { formUsage } from '../usage'
import { FormBuilder } from './FormBuilder'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.forms')} · ${t('nav.admin')}` }
}

export default async function FormEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.config')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const def = id === 'new' ? null : await db.formDefinition.findFirst({ where: { id, orgId: ctx.org.id } })
  if (id !== 'new' && !def) notFound()
  const used = def ? (await formUsage(ctx.org.id, [def.key])).get(def.key) ?? 0 : 0
  return (
    <main className="panel main">
      <AdminHead section={t('admin.nav.forms')} href="/admin/forms" title={def ? def.name : t('forms.admin.new')} sub={def ? `${def.key} · v${def.version} · ${t('forms.admin.usedN', { n: used })}` : t('forms.admin.newSub')}>
        <Link className="btn ghost" href="/admin/forms">{t('common.back')}</Link>
        {def && !used && <ActBtn action={deleteFormAction.bind(null, def.id)} className="btn danger" confirm="admin.common.deleteConfirm" context={<span><strong>{def.name}</strong> · v{def.version}</span>}>{t('common.delete')}</ActBtn>}
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          {def && (def.active || used > 0) && <div className="alert info"><span className="grow">{t('forms.admin.versionHint', { v: def.version })}</span></div>}
          <FormBuilder
            initial={def ? { id: def.id, name: def.name, category: def.category, description: def.description ?? '', active: def.active, fields: readFields(def.fields) } : null}
          />
        </div>
      </div>
    </main>
  )
}
