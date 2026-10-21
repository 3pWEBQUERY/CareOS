import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { AdminNav, AdminWorkspace } from './AdminNav'
import { ADMIN_SECTIONS } from './sections'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const { t } = ctx
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.perm))
  if (!sections.length) return <Forbidden text={t('common.notAllowed')} />
  const items = [
    { href: '/admin', label: t('admin.nav.overview'), hint: t('admin.nav.overviewHint') },
    ...sections.map((s) => ({ href: s.href, label: t('admin.nav.' + s.key), hint: t('admin.nav.' + s.key + 'Hint') })),
  ]
  return (
    <AdminWorkspace>
      <AdminNav title={t('admin.title')} items={items} />
      {children}
    </AdminWorkspace>
  )
}
