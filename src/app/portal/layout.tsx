import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import { pickLocale, type Locale, type Tree } from '@/i18n/core'
import { Toaster } from '@/components/toast'
import { getPortalSession } from '@/lib/portal/auth'

export const metadata: Metadata = { title: { default: 'Portal', template: '%s · Portal' }, robots: { index: false, follow: false } }

/**
 * Angehörigenportal (PRD §60): eigener Bereich ausserhalb der Stationsapp, eigenes Wörterbuch (common + portal).
 * Sprache aus dem Portal-Konto, sonst aus Cookie/Browser – nie aus der Sitzung der Mitarbeitenden.
 */
export default async function PortalRootLayout({ children }: { children: React.ReactNode }) {
  const s = await getPortalSession()
  const jar = await cookies()
  const locale: Locale = (s?.account.locale as Locale) ?? pickLocale(jar.get('careos_locale')?.value ?? (await headers()).get('accept-language'))
  const d = dictionary(locale)
  const messages: Tree = { common: d.common, portal: d.portal }
  return (
    <I18nProvider locale={locale} terminology="resident" messages={messages}>
      <div lang={locale} className="portal-root">{children}</div>
      <Toaster />
    </I18nProvider>
  )
}
