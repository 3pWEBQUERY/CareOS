import Link from 'next/link'
import { InstallApp } from '@/components/shell/InstallApp'
import { getCtx } from '@/lib/context'
import { SignOutForm } from '@/components/shell/SignOutForm'
import { UnitSwitcher } from '@/components/shell/UnitSwitcher'
import { isPlatformOperator } from '@/lib/platform-core'
import type { Permission } from '@/lib/permissions'

/** Mobile "Mehr": alle Bereiche, die nicht in der Bottom-Navigation liegen, und die Bereichswahl (Topbar zeigt sie dort nicht). */
export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.more') }
}

export default async function MorePage() {
  const ctx = await getCtx()
  const { t } = ctx
  const any = (p: string) => ctx.grants.some((g) => g.permissions.some((x) => x.startsWith(p)))
  const items = [
    ctx.can('handover.read') && ['/handover', t('nav.handover')],
    ctx.can('resident.medication.administer') && ['/tasks/medround', t('nav.medround')],
    ctx.can('resident.read') && ctx.hasModule('visit') && ['/tasks/visit', t('visit.nav')],
    ctx.can('therapy.read' as Permission) && ['/therapy', t('nav.therapy')],
    any('spitex.') && ['/spitex', t('nav.spitex')],
    ctx.can('portal.respond' as Permission) && ctx.hasModule('portals') && ['/team/family', t('nav.family')],
    ctx.can('schedule.read') && ['/schedule', t('nav.schedule')],
    ctx.can('chat.use') && ['/chat', t('nav.chat')],
    ctx.can('learn.read') && ['/learn', t('nav.learn')],
    ctx.can('docs.read') && ['/docs', t('nav.docs')],
    ctx.can('quality.report') && ['/quality', t('nav.quality')],
    ctx.can('insights.view') && ['/insights', t('nav.insights')],
    ctx.can('team.read') && ['/team/people', t('nav.people')],
    any('admin.') && ['/admin', t('nav.admin')],
    (ctx.can('api.personal') || ctx.can('admin.integrations')) && ['/developer', t('nav.developer')],
    isPlatformOperator(ctx.user) && ['/platform', t('nav.platform')],
    ['/profile', t('nav.profile')],
    ['/feedback', t('nav.feedback')],
  ].filter(Boolean) as [string, string][]
  const units = ctx.units.map((u) => ({ id: u.id, name: u.name, location: u.location.name }))
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><div><div className="lbl">{ctx.org.name}</div><h1>{t('nav.more')}</h1></div></div>
      <div className="scroll">
        <div className="tabpanel">
          {units.length > 1 && (
            <UnitSwitcher field units={units} current={ctx.unit?.id ?? null} label={t('nav.areas')} />
          )}
          <nav className="more-grid" aria-label={t('nav.more')}>
            {items.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <InstallApp />
          <SignOutForm className="btn block" label={t('common.signOut')} />
        </div>
      </div>
    </main>
  )
}
