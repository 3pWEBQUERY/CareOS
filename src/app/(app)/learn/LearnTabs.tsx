import Link from 'next/link'
import type { Ctx } from '@/lib/context'

/** Register von CareOS Learn. */
export function LearnTabs({ ctx, current }: { ctx: Ctx; current: 'mine' | 'catalog' | 'certificates' | 'compliance' | 'manage' }) {
  const { t } = ctx
  const tabs: [typeof current, string, string][] = [
    ['mine', '/learn', t('learn.tabs.mine')],
    ['catalog', '/learn/catalog', t('learn.tabs.catalog')],
    ['certificates', '/learn/certificates', t('learn.tabs.certificates')],
    ...(ctx.can('learn.manage')
      ? ([['compliance', '/learn/compliance', t('learn.tabs.compliance')], ['manage', '/learn/manage', t('learn.tabs.manage')]] as [typeof current, string, string][])
      : []),
  ]
  return (
    <nav className="tabs" aria-label={t('nav.learn')}>
      {tabs.map(([k, href, label]) => <Link key={k} href={href} aria-current={k === current ? 'page' : undefined}>{label}</Link>)}
    </nav>
  )
}

export function LearnHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="view-head">
      <div>
        <span className="lbl">CareOS Learn</span>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions}
    </div>
  )
}
