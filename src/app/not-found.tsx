import Link from 'next/link'
import { Brand } from '@/components/Brand'
import { getSession } from '@/lib/auth/session'
import { publicT } from '@/lib/i18n-server'
import { dictionary } from '@/i18n'
import { makeT, type Locale } from '@/i18n/core'

export const metadata = { title: '404' }

/** Unbekannte Adresse (ausserhalb der App-Shell). */
export default async function NotFound() {
  const s = await getSession()
  const t = s ? makeT(dictionary(s.user.locale as Locale), s.user.locale as Locale, 'resident') : (await publicT()).t
  return (
    <main className="auth">
      <div className="auth-card">
        <header><Brand /></header>
        <div className="body">
          <h1 style={{ margin: 0, fontSize: '1.125rem' }}>{t('common.notFoundPage.title')}</h1>
          <p className="fg2" style={{ margin: 0 }}>{t('common.notFoundPage.text')}</p>
          <Link className="btn primary" href="/">{t('common.notFoundPage.back')}</Link>
        </div>
      </div>
    </main>
  )
}
