import Link from 'next/link'
import type { Ctx } from '@/lib/context'

export type FamilyTab = 'inbox' | 'updates' | 'accounts'

/** Kopf und Register der Team-Seite «Angehörige» (gleicher Aufbau wie jede Ansicht). */
export function FamilyHead({ ctx, tab, title, sub, counts, children }: { ctx: Ctx; tab: FamilyTab; title: string; sub?: string; counts?: Partial<Record<FamilyTab, number>>; children?: React.ReactNode }) {
  const { t } = ctx
  const tabs: { k: FamilyTab; href: string; show: boolean }[] = [
    { k: 'inbox', href: '/team/family', show: ctx.can('portal.respond') },
    { k: 'updates', href: '/team/family/updates', show: ctx.can('portal.manage') },
    { k: 'accounts', href: '/team/family/accounts', show: ctx.can('portal.manage') || ctx.can('portal.respond') },
  ]
  return (
    <>
      <div className="view-head">
        <div>
          <span className="lbl">{t('portal.team.label')}</span>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
        {children && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{children}</div>}
      </div>
      <nav className="tabs" aria-label={t('portal.team.label')}>
        {tabs.filter((x) => x.show).map((x) => (
          <Link key={x.k} href={x.href} aria-current={tab === x.k ? 'page' : undefined}>
            {t('portal.team.tabs.' + x.k)}
            {!!counts?.[x.k] && <span className="pill accent">{counts[x.k]}</span>}
          </Link>
        ))}
      </nav>
    </>
  )
}

/** Hinweis, wenn das Modul für die Organisation ausgeschaltet ist. */
export function ModuleOff({ ctx }: { ctx: Ctx }) {
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><div><span className="lbl">{ctx.t('portal.team.label')}</span><h1>{ctx.t('portal.team.title')}</h1></div></div>
      <div className="tabpanel"><div className="alert info" role="status"><span className="grow">{ctx.t('portal.team.moduleOff')}</span></div></div>
    </main>
  )
}
