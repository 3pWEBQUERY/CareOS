import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { Brand } from '@/components/Brand'
import { db } from '@/lib/db'
import { dictionary } from '@/i18n'
import { makeT, pickLocale, type Locale, type Terminology } from '@/i18n/core'
import { fmtDate } from '@/lib/time'
import { findPortalInvite } from '@/lib/portal/invites'
import { residentVisible } from '@/lib/portal/policy'
import { portalEnabled } from '@/lib/portal/module'
import { InviteAcceptForm } from './InviteAcceptForm'

export const metadata: Metadata = { title: 'Portal', referrer: 'no-referrer' }

/** Landeseite des Einladungslinks: neues Konto anlegen oder bestehendes Konto verbinden. */
export default async function PortalInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? ''
  const { access, problem } = await findPortalInvite(token)
  const org = access ? await db.organization.findUnique({ where: { id: access.orgId } }) : null
  const jar = await cookies()
  const locale: Locale = pickLocale(jar.get('careos_locale')?.value ?? (await headers()).get('accept-language') ?? org?.defaultLocale)
  const t = makeT(dictionary(locale), locale, (org?.terminology ?? 'resident') as Terminology)
  const usable = access && !problem && residentVisible(access.resident) && portalEnabled(org)
  const existing = usable ? await db.portalAccount.findUnique({ where: { orgId_email: { orgId: access.orgId, email: access.inviteEmail } }, select: { id: true } }) : null
  const reason = problem ?? (access && !usable ? 'unavailable' : 'invalid')
  const k = (s: string, v?: Record<string, string>) => t('portal.accept.' + s, v)
  const labels = Object.fromEntries(
    ['name', 'email', 'password', 'repeat', 'rules', 'privacy', 'submitNew', 'submitExisting', 'existingHint'].map((x) => [x, k(x)])
      .concat(['invalid', 'used', 'revoked', 'expired', 'unavailable', 'rate', 'name', 'mismatch', 'privacy', 'min_length', 'only_digits', 'accountLocked'].map((x) => ['err_' + x, t('portal.acceptErrors.' + x)])),
  )
  return (
    <main className="auth">
      <div className="auth-card">
        <header>
          <Brand name={org?.brandName || org?.name} />
          <div>
            <h1>{k('title')}</h1>
            {usable && <span className="small muted">{k('for', { name: `${access.resident.firstName} ${access.resident.lastName}` })}</span>}
          </div>
        </header>
        <div className="body">
          {usable ? (
            <>
              <p className="fg2" style={{ margin: 0 }}>{k('hint', { org: org!.brandName || org!.name, until: fmtDate(access.inviteExpiresAt!, locale) })}</p>
              <details className="portal-privacy">
                <summary>{k('privacyTitle')}</summary>
                <p className="small fg2">{k('privacyText')}</p>
              </details>
              <InviteAcceptForm token={token} email={access.inviteEmail} name={access.inviteName} existing={!!existing} locale={locale} labels={labels} />
            </>
          ) : <div className="alert warn" role="alert"><span className="grow">{t('portal.acceptErrors.' + reason)}</span></div>}
        </div>
        <footer><Link className="linkbtn small" href="/portal/login">{k('toLogin')}</Link></footer>
      </div>
    </main>
  )
}
