import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { parseUserAgent } from '@/lib/admin-shared'
import { cookies } from 'next/headers'
import { TEXT_COOKIE, normalizeTextSize, normalizeTheme } from '@/lib/theme'
import { SignOutForm } from '@/components/shell/SignOutForm'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn } from '@/components/admin/ui'
import { Empty } from '@/components/ui/Empty'
import { MfaSetupBanner } from './MfaSetupBanner'
import { PushSection } from './PushSection'
import { NotificationSection } from './NotificationSection'
import { InstallApp } from '@/components/shell/InstallApp'
import { LocaleChooser, MfaPanel, PasskeyRegister, PasskeyRename, TextSizeChooser, ThemeChooser } from './ProfileClient'
import { changePasswordAction, deletePasskeyAction, revokeOtherSessionsAction, revokeSessionAction, updateContactAction } from './actions'
import { Checkbox, TextField } from '@/components/ui/fields'
import { Avatar } from '@/components/people/Avatar'
import { avatarUrl } from '@/lib/people'
import { AvatarEditor } from './AvatarEditor'

export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.profile') }
}

export default async function ProfilePage() {
  const ctx = await getCtx()
  const { t, user, locale } = ctx
  const now = new Date()
  const [sessions, passkeys, assignments, quals, certs, primaryUnit] = await Promise.all([
    db.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: now } }, orderBy: { lastSeenAt: 'desc' } }),
    db.passkey.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }),
    db.roleAssignment.findMany({ where: { userId: user.id }, include: { role: true, unit: true, location: true } }),
    db.userQualification.findMany({ where: { userId: user.id }, include: { qualification: true }, orderBy: { qualification: { level: 'desc' } } }),
    db.certificate.findMany({ where: { userId: user.id }, orderBy: { issuedAt: 'desc' }, take: 8 }),
    user.primaryUnitId ? db.unit.findUnique({ where: { id: user.primaryUnitId }, include: { location: true } }) : null,
  ])
  const dt = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const d = (d: Date) => fmtDate(d, locale)
  const rel = (x: Date) => fmtRel(x, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const device = (ua: string | null) => {
    const p = parseUserAgent(ua)
    return [p.browser || t('profile.sessions.unknownBrowser'), p.os].filter(Boolean).join(' · ')
  }
  const current = parseUserAgent(ctx.userAgent)
  const defaultPasskeyName = [current.os, current.browser].filter(Boolean).join(' · ') || 'Passkey'
  const scope = (a: (typeof assignments)[number]) => (a.unit ? `${t('profile.roles.unit')}: ${a.unit.name}` : a.location ? `${t('profile.roles.location')}: ${a.location.name}` : t('profile.roles.org'))

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap', minWidth: 0 }}>
          <Avatar src={avatarUrl(user.avatarFileId)} initials={user.initials} size="lg" />
          <div style={{ minWidth: 0 }}>
            <span className="lbl">{t('profile.title')}</span>
            <h1>{user.firstName} {user.lastName}</h1>
            <p className="sub">{[user.jobTitle, user.email].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <SignOutForm className="btn" label={t('common.signOut')} />
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <MfaSetupBanner />
          <div className="grid-2">
            <section className="card" aria-labelledby="p-personal">
              <div className="card-head"><h2 id="p-personal">{t('profile.personal.title')}</h2><span className="small muted">{t('profile.personal.managed')}</span></div>
              <div className="card-body stack">
                <dl className="kv">
                  <dt>{t('profile.personal.name')}</dt><dd>{user.firstName} {user.lastName}</dd>
                  <dt>{t('profile.personal.initials')}</dt><dd className="mono">{user.initials}</dd>
                  <dt>{t('profile.personal.email')}</dt><dd>{user.email}</dd>
                  <dt>{t('profile.personal.jobTitle')}</dt><dd>{user.jobTitle ?? '–'}</dd>
                  <dt>{t('profile.personal.employeeNo')}</dt><dd className="mono">{user.employeeNo ?? '–'}</dd>
                  <dt>{t('profile.personal.primaryUnit')}</dt><dd>{primaryUnit ? `${primaryUnit.name} · ${primaryUnit.location.name}` : '–'}</dd>
                  <dt>{t('profile.personal.org')}</dt><dd>{ctx.org.name}</dd>
                  <dt>{t('profile.personal.lastLogin')}</dt><dd className="mono">{user.lastLoginAt ? dt(user.lastLoginAt) : '–'}</dd>
                </dl>
              </div>
            </section>

            <section className="card" aria-labelledby="p-appearance">
              <div className="card-head"><h2 id="p-appearance">{t('profile.appearance.title')}</h2></div>
              <div className="card-body stack">
                <div className="stack-sm">
                  <span className="lbl">{t('common.theme.label')}</span>
                  <ThemeChooser current={normalizeTheme(user.theme)} />
                  <span className="small muted">{t('profile.appearance.themeHint')}</span>
                </div>
                <div className="stack-sm">
                  <span className="lbl">{t('profile.appearance.textSize')}</span>
                  <TextSizeChooser current={normalizeTextSize((await cookies()).get(TEXT_COOKIE)?.value)} />
                  <span className="small muted">{t('profile.appearance.textSizeHint')}</span>
                </div>
                <div className="stack-sm">
                  <span className="lbl">{t('profile.appearance.language')}</span>
                  <LocaleChooser current={locale} />
                  <span className="small muted">{t('profile.appearance.languageHint')}</span>
                </div>
              </div>
            </section>
          </div>

          <section className="card" aria-labelledby="p-people" id="p-people">
            <div className="card-head"><h2 id="p-people">{t('people.me.title')}</h2><Link className="linkbtn small" href={`/team/people/${user.id}`}>{t('people.me.preview')} →</Link></div>
            <div className="card-body ppl-me">
              <AvatarEditor src={avatarUrl(user.avatarFileId)} initials={user.initials} />
              <ActionForm action={updateContactAction} reset={false} success="common.saved">
                <div className="form-grid">
                  <TextField label={t('people.me.workPhone')} hint={t('people.me.workPhoneHint')} name="workPhone" type="tel" autoComplete="tel-extension" defaultValue={user.workPhone ?? ''} maxLength={40} />
                  <TextField label={t('people.me.phone')} hint={t('people.me.phoneHint')} name="phone" type="tel" autoComplete="tel" defaultValue={user.phone ?? ''} maxLength={40} />
                </div>
                <Checkbox name="phoneShared" defaultChecked={user.phoneShared} label={t('people.me.phoneShared')} />
                <div className="form-actions"><Submit className="btn">{t('common.save')}</Submit></div>
              </ActionForm>
            </div>
          </section>

          <InstallApp />
          <PushSection />
          <NotificationSection />

          <h2 className="sec">{t('profile.security')}</h2>
          <div className="grid-2">
            <section className="card" aria-labelledby="p-mfa">
              <div className="card-head">
                <h2 id="p-mfa">{t('profile.mfa.title')}</h2>
                {user.mfaEnabled ? <span className="tag ok">{t('profile.mfa.on')}</span> : <span className="tag warn">{t('profile.mfa.off')}</span>}
              </div>
              <div className="card-body"><MfaPanel enabled={user.mfaEnabled} /></div>
            </section>

            <section className="card" aria-labelledby="p-passkeys">
              <div className="card-head"><h2 id="p-passkeys">{t('profile.passkeys.title')}</h2><span className="small muted">{t('profile.passkeys.count', { n: passkeys.length })}</span></div>
              <div className="card-body stack">
                <p className="fg2" style={{ margin: 0 }}>{t('profile.passkeys.hint')}</p>
                {passkeys.length > 0 && (
                  <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
                    {passkeys.map((p) => (
                      <li key={p.id}>
                        <div className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <div className="grow">
                            <div>{p.name}</div>
                            <div className="small muted">{t('profile.passkeys.created', { date: d(p.createdAt) })} · {p.lastUsedAt ? t('profile.passkeys.lastUsed', { date: rel(p.lastUsedAt) }) : t('profile.passkeys.neverUsed')}</div>
                          </div>
                          <PasskeyRename id={p.id} name={p.name} />
                          <ActBtn action={deletePasskeyAction.bind(null, p.id)} className="btn sm danger" confirm="profile.passkeys.deleteConfirm">{t('common.delete')}</ActBtn>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <PasskeyRegister defaultName={defaultPasskeyName} />
              </div>
            </section>
          </div>

          <section className="card" aria-labelledby="p-sessions">
            <div className="card-head">
              <h2 id="p-sessions">{t('profile.sessions.title')}</h2>
              {sessions.length > 1 && <ActBtn action={revokeOtherSessionsAction} className="btn sm danger" confirm="profile.sessions.revokeOthersConfirm">{t('profile.sessions.revokeOthers')}</ActBtn>}
            </div>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="stable">
                <thead>
                  <tr><th>{t('profile.sessions.device')}</th><th>{t('profile.sessions.ip')}</th><th>{t('profile.sessions.since')}</th><th>{t('profile.sessions.lastSeen')}</th><th className="right"><span className="sr-only">{t('profile.sessions.actions')}</span></th></tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span>{device(s.userAgent)}</span>
                          <span className="tag outline">{t('profile.sessions.kind.' + parseUserAgent(s.userAgent).kind)}</span>
                          {s.id === ctx.sessionId && <span className="tag accent">{t('profile.sessions.current')}</span>}
                          {!s.mfaPassed && <span className="tag warn">{t('profile.sessions.mfaPending')}</span>}
                        </div>
                      </td>
                      <td className="num">{s.ip ?? '–'}</td>
                      <td className="num nowrap">{dt(s.createdAt)}</td>
                      <td className="num nowrap">{rel(s.lastSeenAt)}</td>
                      <td className="right">
                        {s.id !== ctx.sessionId && <ActBtn action={revokeSessionAction.bind(null, s.id)} className="btn sm" confirm="profile.sessions.revokeConfirm">{t('profile.sessions.revoke')}</ActBtn>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid-2">
            <section className="card" aria-labelledby="p-password">
              <div className="card-head"><h2 id="p-password">{t('profile.password.title')}</h2></div>
              <div className="card-body">
                <ActionForm action={changePasswordAction} success="profile.password.changed">
                  {/* Für Passwortmanager: Benutzername als verstecktes Feld – raw-field-ok: unsichtbar */}
                  <input type="text" name="username" autoComplete="username" defaultValue={user.email} hidden readOnly />
                  <TextField label={t('profile.password.current')} type="password" name="current" autoComplete="current-password" required />
                  <TextField label={t('profile.password.new')} hint={t('profile.password.rules')} type="password" name="next" autoComplete="new-password" minLength={10} required />
                  <TextField label={t('profile.password.repeat')} type="password" name="repeat" autoComplete="new-password" minLength={10} required />
                  <p className="small muted" style={{ margin: 0 }}>{t('profile.password.revokeHint')}</p>
                  <div className="form-actions"><Submit>{t('profile.password.submit')}</Submit></div>
                </ActionForm>
              </div>
            </section>

            <div className="stack">
              <section className="card" aria-labelledby="p-roles">
                <div className="card-head"><h2 id="p-roles">{t('profile.roles.title')}</h2></div>
                {assignments.length ? (
                  <ul className="list">
                    {assignments.map((a) => (
                      <li key={a.id}><div className="li"><div className="grow"><div>{a.role.name}</div><div className="small muted">{scope(a)}</div></div><span className="pill">{a.role.permissions.length}</span></div></li>
                    ))}
                  </ul>
                ) : <div className="card-body"><Empty title={t('profile.roles.none')} /></div>}
              </section>

              <section className="card" aria-labelledby="p-quals">
                <div className="card-head"><h2 id="p-quals">{t('profile.qualifications.title')}</h2></div>
                {quals.length ? (
                  <ul className="list">
                    {quals.map((q) => {
                      const expired = q.validUntil && q.validUntil < now
                      return (
                        <li key={q.qualificationId}>
                          <div className="li">
                            <div className="grow"><div>{q.qualification.name}</div><div className="small muted">{t('profile.qualifications.level', { n: q.qualification.level })}</div></div>
                            {q.validUntil && <span className={'tag' + (expired ? ' crit' : '')}>{expired ? t('profile.qualifications.expired', { date: d(q.validUntil) }) : t('profile.qualifications.validUntil', { date: d(q.validUntil) })}</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : <div className="card-body"><Empty title={t('profile.qualifications.none')} /></div>}
              </section>

              <section className="card" aria-labelledby="p-certs">
                <div className="card-head"><h2 id="p-certs">{t('profile.certificates.title')}</h2><Link href="/learn/certificates" className="linkbtn small">{t('profile.certificates.all')}</Link></div>
                {certs.length ? (
                  <ul className="list">
                    {certs.map((c) => {
                      const expired = c.expiresAt && c.expiresAt < now
                      return (
                        <li key={c.id}>
                          <div className="li">
                            <div className="grow"><div>{c.title}</div><div className="small muted">{t('profile.certificates.issued', { date: d(c.issuedAt) })}</div></div>
                            {c.expiresAt && <span className={'tag' + (expired ? ' crit' : '')}>{expired ? t('profile.qualifications.expired', { date: d(c.expiresAt) }) : t('profile.qualifications.validUntil', { date: d(c.expiresAt) })}</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : <div className="card-body"><Empty title={t('profile.certificates.none')} /></div>}
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
