import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { logoutAction } from '@/app/login/actions'

/** Mobile "Mehr": alle Bereiche, die nicht in der Bottom-Navigation liegen. */
export default async function MorePage() {
  const ctx = await getCtx()
  const { t } = ctx
  const any = (p: string) => ctx.grants.some((g) => g.permissions.some((x) => x.startsWith(p)))
  const items = [
    ctx.can('handover.read') && ['/handover', t('nav.handover')],
    ctx.can('resident.medication.administer') && ['/tasks/medround', t('nav.medround')],
    ctx.can('schedule.read') && ['/schedule', t('nav.schedule')],
    ctx.can('chat.use') && ['/chat', t('nav.chat')],
    ctx.can('learn.read') && ['/learn', t('nav.learn')],
    ctx.can('docs.read') && ['/docs', t('nav.docs')],
    ctx.can('quality.report') && ['/quality', t('nav.quality')],
    ctx.can('insights.view') && ['/insights', t('nav.insights')],
    any('admin.') && ['/admin', t('nav.admin')],
    ['/profile', t('nav.profile')],
  ].filter(Boolean) as [string, string][]
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><h1>{t('nav.more')}</h1></div>
      <div className="tabpanel">
        <nav className="more-grid" aria-label={t('nav.more')}>
          {items.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <form action={logoutAction}><button className="btn block" type="submit">{t('common.signOut')}</button></form>
      </div>
    </main>
  )
}
