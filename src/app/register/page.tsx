import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { Brand } from '@/components/Brand'
import { getSession } from '@/lib/auth/session'
import { publicT } from '@/lib/i18n-server'
import { orgSignupEnabled } from '@/lib/registration'
import { RegisterForm } from './RegisterForm'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await publicT()).t('register.title') }
}

const KEYS = [
  'code', 'codeHint', 'firstName', 'lastName', 'email', 'password', 'passwordHint', 'note', 'noteHint', 'orgName', 'consent', 'privacyTitle', 'privacyText', 'privacyOrg',
  'submit', 'submitOrg', 'doneTitle', 'doneText', 'doneOrgTitle', 'doneOrgText', 'toLogin',
] as const
const ERRORS = ['code', 'firstName', 'lastName', 'email', 'passwordLength', 'passwordDigits', 'note', 'consent', 'orgName', 'rate', 'disabled', 'generic'] as const

/** Selbstregistrierung (PRD §33): Konto mit Registrierungscode beantragen; optional neue Organisation (ORG_SIGNUP=true). */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const s = await getSession()
  if (s?.mfaPassed) redirect('/')
  const { t } = await publicT()
  const orgSignup = orgSignupEnabled()
  const requests = (await db.organization.count({ where: { settings: { path: ['registration', 'enabled'], equals: true } } })) > 0
  const mode = (await searchParams).mode === 'org' && orgSignup ? 'org' : 'request'
  const open = mode === 'org' || requests
  const labels: Record<string, string> = Object.fromEntries(KEYS.map((k) => [k, t('register.' + k)]))
  for (const k of ERRORS) labels['register.errors.' + k] = t('register.errors.' + k)
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{t(mode === 'org' ? 'register.orgTitle' : 'register.title')}</h1>
            <span className="small muted">{t(mode === 'org' ? 'register.orgSubtitle' : 'register.subtitle')}</span>
          </div>
        </header>
        <div className="body">
          {orgSignup && (
            <nav className="seg reg-seg" aria-label={t('register.mode')}>
              <Link href="/register" aria-current={mode === 'request' ? 'page' : undefined}>{t('register.modeRequest')}</Link>
              <Link href="/register?mode=org" aria-current={mode === 'org' ? 'page' : undefined}>{t('register.modeOrg')}</Link>
            </nav>
          )}
          {open ? <RegisterForm key={mode} mode={mode} labels={labels} /> : <div className="alert warn"><span className="grow">{t('register.closed')}</span></div>}
        </div>
        <footer>
          <span>{t('auth.footer')}</span>
          <Link className="linkbtn small" href="/login">{t('register.toLogin')}</Link>
        </footer>
      </div>
    </main>
  )
}
