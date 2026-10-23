import Link from 'next/link'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import { Brand } from '@/components/Brand'
import { Toaster } from '@/components/toast'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { Forbidden } from '@/components/ui/Empty'
import { platformAccess } from './access'

/**
 * Plattform-Betrieb (PRD §42): eigener Bereich ausserhalb der Stationsapp, ohne Navigation zu klinischen Modulen.
 * Zugang nur für `User.platformRole = 'operator'` mit zweitem Faktor.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const { ctx, ok, mfa } = await platformAccess()
  const { t } = ctx
  const body = !ok ? (
    <Forbidden text={t('tenancy.platform.noAccess')} />
  ) : !mfa ? (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><h1>{t('tenancy.platform.title')}</h1></div>
      <div className="tabpanel"><div className="alert warn" role="alert"><span className="grow">{t('tenancy.platform.mfa')} <Link href="/profile">{t('tenancy.platform.mfaLink')}</Link></span></div></div>
    </main>
  ) : children
  return (
    <I18nProvider locale={ctx.locale} terminology={ctx.terminology} messages={dictionary(ctx.locale)}>
      <a className="skip" href="#main">{t('common.skipToContent')}</a>
      <div className="plat-shell">
        <header className="topbar">
          <Link href="/platform" style={{ textDecoration: 'none' }} aria-label={`CareOS – ${t('tenancy.platform.title')}`}><Brand /></Link>
          <div className="ctx"><span>{t('tenancy.platform.section')}</span></div>
          <span className="grow" />
          <ThemeToggle />
          <Link className="btn sm ghost" href="/">{t('tenancy.platform.back')}</Link>
        </header>
        <div className="plat-content" id="main">{body}</div>
      </div>
      <Toaster />
    </I18nProvider>
  )
}
