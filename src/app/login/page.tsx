import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Brand } from '@/components/Brand'
import { getSession } from '@/lib/auth/session'
import { publicT } from '@/lib/i18n-server'
import { env, ssoConfigured } from '@/lib/env'
import { LoginForm } from './LoginForm'
import { ClearSnapshot } from './ClearSnapshot'

export const metadata: Metadata = { title: 'Anmelden' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams
  const s = await getSession()
  if (s?.mfaPassed) redirect('/')
  const { t } = await publicT()
  const next = sp.next?.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/'
  const keys = ['email', 'password', 'submit', 'passkey', 'or', 'invalid', 'locked', 'inactive', 'passkeyFailed'] as const
  const labels = Object.fromEntries(keys.map((k) => [k, t('auth.' + k)])) as Record<(typeof keys)[number], string>
  return (
    <main className="auth">
      <ClearSnapshot />
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{t('auth.title')}</h1>
            <span className="small muted">{t('auth.subtitle')}</span>
          </div>
        </header>
        <div className="body">
          {sp.error === 'sso' && <p className="alert crit" role="alert">{t('auth.ssoFailed')}</p>}
          <LoginForm labels={labels} next={next} sso={ssoConfigured() ? { label: env.oidc.label } : null} />
          {process.env.SEED_DEMO === 'true' && <p className="small muted" style={{ margin: 0 }}>{t('auth.demoHint')}</p>}
        </div>
        <footer>
          <span>{t('auth.footer')}</span>
        </footer>
      </div>
    </main>
  )
}
