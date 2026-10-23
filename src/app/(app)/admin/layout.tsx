import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { orgSettings } from '@/lib/admin'
import { Forbidden } from '@/components/ui/Empty'
import { AdminNav, AdminWorkspace } from './AdminNav'
import { ADMIN_SECTIONS } from './sections'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const { t } = ctx
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.perm) || (!!s.alsoPerm && ctx.can(s.alsoPerm)))
  if (!sections.length) return <Forbidden text={t('common.notAllowed')} />
  // Organisationseinstellung: Admin-Bereich nur mit zweitem Faktor (TOTP oder Passkey).
  if (orgSettings(ctx.org.settings).requireMfaForAdmins && !ctx.user.mfaEnabled && !(await db.passkey.count({ where: { userId: ctx.user.id } })))
    return (
      <main className="panel main" style={{ flex: 1 }}>
        <div className="tabpanel">
          <div className="alert warn"><span className="grow"><strong>{t('admin.mfaRequired.title')}</strong>{t('admin.mfaRequired.text')} <Link href="/profile">{t('nav.profile')}</Link></span></div>
        </div>
      </main>
    )
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
