import { redirect } from 'next/navigation'
import { Brand } from '@/components/Brand'
import { getSession } from '@/lib/auth/session'
import { publicT } from '@/lib/i18n-server'
import { logoutAction } from '../actions'
import { MfaForm } from './MfaForm'

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession()
  if (!s) redirect('/login')
  if (s.mfaPassed) redirect('/')
  const { t } = await publicT()
  const sp = await searchParams
  const next = sp.next?.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/'
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{t('auth.mfaTitle')}</h1>
            <span className="small muted">{s.user.email}</span>
          </div>
        </header>
        <div className="body">
          <p className="fg2" style={{ margin: 0 }}>{t('auth.mfaHint')}</p>
          <MfaForm next={next} labels={{ mfaCode: t('auth.mfaCode'), mfaSubmit: t('auth.mfaSubmit'), mfaInvalid: t('auth.mfaInvalid'), locked: t('auth.locked') }} />
        </div>
        <footer>
          <form action={logoutAction}><button className="linkbtn small" type="submit">{t('auth.otherAccount')}</button></form>
        </footer>
      </div>
    </main>
  )
}
