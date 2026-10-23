import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Brand } from '@/components/Brand'
import { dictionary } from '@/i18n'
import { makeT, type Locale } from '@/i18n/core'
import { getPortalSession } from '@/lib/portal/auth'
import { safePortalNext } from '@/lib/portal/routing'
import { portalLogoutAction } from '../../actions'
import { PortalMfaForm } from './PortalMfaForm'

export const metadata: Metadata = { title: 'MFA' }

export default async function PortalMfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getPortalSession()
  if (!s) redirect('/portal/login')
  if (s.mfaPassed) redirect('/portal')
  const locale = s.account.locale as Locale
  const t = makeT(dictionary(locale), locale, 'resident')
  const next = safePortalNext((await searchParams).next)
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{t('portal.mfa.title')}</h1>
            <span className="small muted">{s.account.email}</span>
          </div>
        </header>
        <div className="body">
          <p className="fg2" style={{ margin: 0 }}>{t('portal.mfa.hint')}</p>
          <PortalMfaForm next={next} labels={{ code: t('portal.mfa.code'), submit: t('portal.mfa.submit'), invalid: t('portal.mfa.invalid'), locked: t('portal.login.locked') }} />
        </div>
        <footer>
          <form action={portalLogoutAction}><button className="linkbtn small" type="submit">{t('portal.mfa.other')}</button></form>
        </footer>
      </div>
    </main>
  )
}
