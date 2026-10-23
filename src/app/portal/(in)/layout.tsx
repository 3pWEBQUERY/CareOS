import Link from 'next/link'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import type { Terminology, Tree } from '@/i18n/core'
import { Brand } from '@/components/Brand'
import { getPortalCtx } from '@/lib/portal/context'
import { portalUnread } from '@/lib/portal/data'
import { PortalNav, type PortalNavItem } from './PortalNav'
import { ResidentSwitch } from './ResidentSwitch'

/** Shell des Angehörigenportals: ruhig, mobil zuerst (Navigation unten), nur freigegebene Bereiche. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const p = await getPortalCtx()
  const { t, current } = p
  const unread = current ? await portalUnread(p, current) : { messages: 0 }
  const nav: PortalNavItem[] = [
    { href: '/portal', label: t('portal.nav.home'), icon: 'home' },
    ...(p.can('messages') ? [{ href: '/portal/messages', label: t('portal.nav.messages'), icon: 'chat' as const, badge: unread.messages, badgeLabel: t('portal.nav.unread') }] : []),
    ...(p.can('visits') ? [{ href: '/portal/visits', label: t('portal.nav.visits'), icon: 'schedule' as const }] : []),
    ...(p.can('files') ? [{ href: '/portal/files', label: t('portal.nav.files'), icon: 'docs' as const }] : []),
    { href: '/portal/account', label: t('portal.nav.account'), icon: 'account' },
  ]
  const d = dictionary(p.locale)
  const messages: Tree = { common: d.common, portal: d.portal }
  const initials = p.account.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')
  return (
    <I18nProvider locale={p.locale} terminology={p.org.terminology as Terminology} messages={messages}>
      <div className="portal">
        <a className="skip" href="#portal-main">{t('portal.nav.skip')}</a>
        <header className="portal-top">
          <Link href="/portal" className="portal-brand" aria-label={t('portal.nav.home')}><Brand name={p.org.brandName || p.org.name} /></Link>
          {p.accesses.length > 1 && current && (
            <ResidentSwitch value={current.id} label={t('portal.nav.person')} options={p.accesses.map((a) => ({ value: a.id, label: `${a.resident.firstName} ${a.resident.lastName}` }))} />
          )}
          <span className="grow" />
          <Link href="/portal/account" className="me" aria-label={t('portal.nav.account') + ': ' + p.account.name}>
            <span className="av" aria-hidden="true">{initials || '?'}</span>
            <span className="portal-me-name">{p.account.name}</span>
          </Link>
        </header>
        <PortalNav items={nav} label={t('portal.nav.label')} />
        <main id="portal-main" className="portal-main" tabIndex={-1}>{children}</main>
      </div>
    </I18nProvider>
  )
}
