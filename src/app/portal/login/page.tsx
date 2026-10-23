import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { Brand } from '@/components/Brand'
import { dictionary } from '@/i18n'
import { makeT, pickLocale } from '@/i18n/core'
import { getPortalSession } from '@/lib/portal/auth'
import { safePortalNext } from '@/lib/portal/routing'
import { PortalLoginForm } from './PortalLoginForm'

async function tPublic() {
  const jar = await cookies()
  const locale = pickLocale(jar.get('careos_locale')?.value ?? (await headers()).get('accept-language'))
  return makeT(dictionary(locale), locale, 'resident')
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await tPublic())('portal.login.title') }
}

/** Anmeldung für Angehörige – getrennt von /login der Mitarbeitenden. */
export default async function PortalLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getPortalSession()
  if (s?.mfaPassed) redirect('/portal')
  const t = await tPublic()
  const next = safePortalNext((await searchParams).next)
  const keys = ['email', 'password', 'submit', 'invalid', 'locked', 'accountLocked', 'unavailable'] as const
  const labels = Object.fromEntries(keys.map((k) => [k, t('portal.login.' + k)])) as Record<(typeof keys)[number], string>
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{t('portal.login.title')}</h1>
            <span className="small muted">{t('portal.login.subtitle')}</span>
          </div>
        </header>
        <div className="body">
          <PortalLoginForm labels={labels} next={next} />
        </div>
        <footer>
          <span>{t('portal.login.footer')}</span>
        </footer>
      </div>
    </main>
  )
}
