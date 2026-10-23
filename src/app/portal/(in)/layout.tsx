import Link from 'next/link'
import { cookies } from 'next/headers'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import type { Terminology, Tree } from '@/i18n/core'
import { Brand } from '@/components/Brand'
import { TEXT_COOKIE, normalizeTextSize } from '@/lib/theme'
import { getPortalCtx } from '@/lib/portal/context'
import { portalUnread } from '@/lib/portal/data'
import { isSelfAccess } from '@/lib/portal/policy'
import { PortalNav, type PortalNavItem } from './PortalNav'
import { ResidentSwitch } from './ResidentSwitch'
import { TextSizeControl, TextSizeSync } from './TextSize'

/**
 * Shell des Portals: ruhig, mobil zuerst (Navigation unten), nur freigegebene Bereiche.
 * Zugang der Person selbst (Bewohnerportal): eigene Bezeichnungen in einfacher Sprache, grössere Schrift
 * und Bedienelemente (.portal.self) und die Schriftgrösse direkt im Kopf.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const p = await getPortalCtx()
  const { t, current, self } = p
  const unread = current ? await portalUnread(p, current) : { messages: 0 }
  const nl = (k: string) => t((self ? 'residentPortal.nav.' : 'portal.nav.') + k)
  const nav: PortalNavItem[] = [
    { href: '/portal', label: nl('home'), icon: 'home' },
    ...(p.can('messages') ? [{ href: '/portal/messages', label: nl('messages'), icon: 'chat' as const, badge: unread.messages, badgeLabel: t('portal.nav.unread') }] : []),
    ...(p.can('visits') ? [{ href: '/portal/visits', label: nl('visits'), icon: 'schedule' as const }] : []),
    ...(p.can('files') ? [{ href: '/portal/files', label: nl('files'), icon: 'docs' as const }] : []),
    { href: '/portal/account', label: nl('account'), icon: 'account' },
  ]
  const d = dictionary(p.locale)
  const messages: Tree = { common: d.common, portal: d.portal, residentPortal: d.residentPortal }
  const initials = p.account.name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('')
  const textSize = p.account.textSize ? normalizeTextSize(p.account.textSize) : null
  return (
    <I18nProvider locale={p.locale} terminology={p.org.terminology as Terminology} messages={messages}>
      {textSize && <TextSizeSync value={textSize} />}
      <div className={'portal' + (self ? ' self' : '')}>
        <a className="skip" href="#portal-main">{t('portal.nav.skip')}</a>
        <header className="portal-top">
          <Link href="/portal" className="portal-brand" aria-label={nl('home')}><Brand name={p.org.brandName || p.org.name} /></Link>
          {p.accesses.length > 1 && current && (
            <ResidentSwitch value={current.id} label={t('portal.nav.person')} options={p.accesses.map((a) => ({ value: a.id, label: isSelfAccess(a) ? t('residentPortal.nav.me') : `${a.resident.firstName} ${a.resident.lastName}` }))} />
          )}
          <span className="grow" />
          {self && <TextSizeControl value={textSize ?? normalizeTextSize((await cookies()).get(TEXT_COOKIE)?.value)} />}
          <Link href="/portal/account" className="me" aria-label={nl('account') + ': ' + p.account.name}>
            <span className="av" aria-hidden="true">{initials || '?'}</span>
            <span className="portal-me-name">{p.account.name}</span>
          </Link>
        </header>
        <PortalNav items={nav} label={self ? t('residentPortal.nav.label') : t('portal.nav.label')} />
        <main id="portal-main" className="portal-main" tabIndex={-1}>{children}</main>
      </div>
    </I18nProvider>
  )
}
