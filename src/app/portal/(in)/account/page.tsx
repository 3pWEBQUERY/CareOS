import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { THEME_COOKIE, TEXT_COOKIE, normalizeTextSize, normalizeTheme } from '@/lib/theme'
import { getPortalCtx } from '@/lib/portal/context'
import { normalizeGrants } from '@/lib/portal/policy'
import { portalLogoutAction } from '../../actions'
import { fmtShortDate, PortalHead, portalPage } from '../ui'
import { MfaSection, PasswordForm, ProfileForm, SignOutOthers } from './AccountForms'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.account.title') }
}

export default async function PortalAccount() {
  const p = await portalPage('account')
  const { t, locale, account } = p
  const jar = await cookies()
  // Alle eigenen Zugänge (auch widerrufene) mit Einwilligung – Transparenz für die Person (PRD §36)
  const all = await db.portalAccess.findMany({
    where: { accountId: account.id, orgId: p.org.id },
    select: { id: true, role: true, grants: true, consentBy: true, consentName: true, consentAt: true, revokedAt: true, resident: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const effective = new Map(p.accesses.map((a) => [a.id, a.grants]))
  return (
    <>
      <PortalHead title={t('portal.account.title')} sub={account.email} />

      <section className="card" aria-labelledby="pa-profile">
        <div className="card-head"><h2 id="pa-profile">{t('portal.account.profile')}</h2></div>
        <div className="card-body">
          <ProfileForm name={account.name} phone={account.phone ?? ''} locale={account.locale} theme={normalizeTheme(jar.get(THEME_COOKIE)?.value)} text={normalizeTextSize(jar.get(TEXT_COOKIE)?.value)} />
        </div>
      </section>

      <section className="card" aria-labelledby="pa-access">
        <div className="card-head"><h2 id="pa-access">{t('portal.account.accesses')}</h2></div>
        <ul className="list">
          {all.map((a) => {
            const grants = effective.get(a.id) ?? []
            return (
              <li key={a.id}><div className="li portal-li" style={{ alignItems: 'flex-start' }}>
                <div className="grow stack-sm">
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong>{a.resident.firstName} {a.resident.lastName}</strong>
                    <span className="tag outline">{t('portal.roles.' + a.role)}</span>
                    {a.revokedAt ? <span className="tag">{t('portal.state.revoked')}</span> : !grants.length && <span className="tag warn">{t('portal.account.paused')}</span>}
                  </div>
                  {!a.revokedAt && <div className="small fg2">{normalizeGrants(grants).map((g) => t('portal.grants.' + g)).join(' · ') || '–'}</div>}
                  <div className="small muted">{t('portal.contact.consent', { name: a.consentName, date: fmtShortDate(a.consentAt, locale), by: t('portal.consentBy.' + a.consentBy) })}</div>
                </div>
              </div></li>
            )
          })}
        </ul>
        <div className="card-foot small muted">{t('portal.account.accessHint')}</div>
      </section>

      <div className="portal-grid">
        <section className="card" aria-labelledby="pa-pw">
          <div className="card-head"><h2 id="pa-pw">{t('portal.account.password')}</h2></div>
          <div className="card-body"><PasswordForm email={account.email} /></div>
        </section>
        <section className="card" aria-labelledby="pa-mfa">
          <div className="card-head"><h2 id="pa-mfa">{t('portal.account.mfa')}</h2><span className="small muted">{t('common.optional')}</span></div>
          <div className="card-body"><MfaSection enabled={account.mfaEnabled} /></div>
        </section>
      </div>

      <section className="card" id="data" aria-labelledby="pa-data">
        <div className="card-head"><h2 id="pa-data">{t('portal.account.data')}</h2></div>
        <div className="card-body stack-sm">
          <p className="small fg2" style={{ margin: 0 }}>{t('portal.account.dataText')}</p>
          <p className="small fg2" style={{ margin: 0 }}>{t('portal.account.dataNever')}</p>
          <p className="small fg2" style={{ margin: 0 }}>{t('portal.account.dataRights')}</p>
        </div>
      </section>

      <section className="card" aria-labelledby="pa-sess">
        <div className="card-head"><h2 id="pa-sess">{t('portal.account.sessions')}</h2></div>
        <div className="card-body row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <SignOutOthers />
          <form action={portalLogoutAction}><button type="submit" className="btn danger">{t('portal.account.logout')}</button></form>
        </div>
      </section>
    </>
  )
}
