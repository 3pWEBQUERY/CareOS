import type { Metadata } from 'next'
import Link from 'next/link'
import { Brand } from '@/components/Brand'
import { publicT } from '@/lib/i18n-server'
import { findLink } from './link'
import { InviteForm } from './InviteForm'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await publicT()).t('profile.invite.title') }
}

/** Landeseite für Einladungs- und Rücksetz-Links aus CareOS Admin. */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { t } = await publicT()
  const token = (await searchParams).token ?? ''
  const link = await findLink(token)
  const k = (s: string) => t('profile.invite.' + s)
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand />
          <div>
            <h1>{link?.ch.kind === 'reset' ? k('resetTitle') : k('title')}</h1>
            {link && <span className="small muted">{link.user.email}</span>}
          </div>
        </header>
        <div className="body">
          {link ? (
            <>
              <p className="fg2" style={{ margin: 0 }}>{k('hint')}</p>
              <InviteForm
                token={token}
                email={link.user.email}
                labels={{
                  password: k('password'), repeat: k('repeat'), rules: t('profile.password.rules'), submit: k('submit'),
                  err_invalid: k('invalid'), err_rate: t('profile.errors.rate'), err_mismatch: t('profile.password.mismatch'),
                  err_min_length: t('profile.password.min_length'), err_only_digits: t('profile.password.only_digits'),
                }}
              />
            </>
          ) : <div className="alert warn"><span className="grow">{k('invalid')}</span></div>}
        </div>
        <footer><Link className="linkbtn small" href="/login">{k('toLogin')}</Link></footer>
      </div>
    </main>
  )
}
