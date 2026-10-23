import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getMdCtx } from '@/lib/md/context'
import { needsMfaSetup } from '@/lib/auth/mfa-gate'
import { MFA_SETUP_URL } from '@/lib/mfa-policy'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import { Brand } from '@/components/Brand'
import { Avatar } from '@/components/people/Avatar'
import { Toaster } from '@/components/toast'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { Notifications } from '@/components/shell/Notifications'
import { SignOutForm } from '@/components/shell/SignOutForm'
import { ScrollRegions } from '@/components/shell/ScrollRegions'

/**
 * Ärzteportal (PRD §60): schlanker Bereich für externe Ärztinnen und Ärzte – ohne Team, Chat, Lernen, Dienstplan.
 * Eigener Kontext (getMdCtx): nur zugeordnete Personen. Zweiter Faktor ist Pflicht (Einrichtung im Profil).
 */
export default async function MdLayout({ children }: { children: React.ReactNode }) {
  const md = await getMdCtx()
  if (await needsMfaSetup(md)) redirect(MFA_SETUP_URL)
  const { t, user, org } = md
  // Ärzteportal hängt am Modul Visite (PRD §69); ohne Modul nur Hinweis, keine Daten
  const off = !md.hasModule('visit')
  const [unread, critical] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.count({ where: { userId: user.id, readAt: null, priority: 'critical' } }),
  ])
  return (
    <I18nProvider locale={md.locale} terminology={md.terminology} messages={dictionary(md.locale)}>
      {org.brandColor && /^#[0-9a-fA-F]{6}$/.test(org.brandColor) && (
        <link rel="stylesheet" href={`/api/brand?c=${org.brandColor.slice(1).toUpperCase()}`} precedence="brand" />
      )}
      <a className="skip" href="#main">{t('common.skipToContent')}</a>
      <div className="md-app">
        <header className="topbar md-top">
          <Link href="/md" style={{ textDecoration: 'none' }} aria-label={`${org.brandName || 'CareOS'} – ${t('md.nav.patients')}`}><Brand name={org.brandName} logoUrl={org.logoFileId ? `/api/files/${org.logoFileId}` : null} /></Link>
          <div className="ctx"><span>{org.name}</span><span className="tag outline">{t('md.portal')}</span></div>
          <span className="spacer" />
          <ThemeToggle />
          <Notifications unread={unread} critical={critical} />
          <Link className="me" href="/profile" aria-label={`${user.firstName} ${user.lastName} – ${t('md.nav.profile')}`}>
            <Avatar src={user.avatarFileId ? `/api/files/${user.avatarFileId}` : null} initials={user.initials} />
            <div>{user.firstName.charAt(0)}. {user.lastName}<small>{user.jobTitle ?? t('md.external')}</small></div>
          </Link>
          <SignOutForm label={t('md.nav.signOut')} className="btn sm md-signout" />
        </header>
        <div className="md-content" id="main">{off ? <main className="panel main" style={{ flex: 1 }}><div className="view-head"><h1>{t('md.portal')}</h1></div><div className="tabpanel"><div className="alert warn" role="status"><span className="grow">{t('common.moduleOff')}</span></div></div></main> : children}</div>
      </div>
      <Toaster />
      <ScrollRegions />
    </I18nProvider>
  )
}
