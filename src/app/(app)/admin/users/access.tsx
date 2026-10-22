import Link from 'next/link'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import type { Ctx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { INVITE_DAYS, awaitingAccessWhere } from '@/lib/invites'
import { readRegistration } from '@/lib/registration-core'
import { registrationCode } from '@/lib/registration'
import { Empty } from '@/components/ui/Empty'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { Select, TextField } from '@/components/ui/fields'
import { approveRequestAction, rejectRequestAction, rotateRegistrationCodeAction, setRegistrationAction } from './actions'
import { CopyBtn, InviteLinks } from './InviteLinks'

/** Platzhalter-Domain aus dem Erststart (INIT_STAFF_DOMAIN) */
const placeholderDomain = (settings: unknown) => {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).placeholderDomain : null
  return typeof v === 'string' && v ? v : null
}

/** Admin → Benutzer → Einladungen: Konten ohne Zugang, Einladungslinks erzeugen (PRD §33). */
export async function InvitesTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const [users, units, org] = await Promise.all([
    db.user.findMany({ where: awaitingAccessWhere(ctx.org.id), select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, primaryUnitId: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 1000 }),
    db.unit.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true } }),
    db.organization.findUnique({ where: { id: ctx.org.id }, select: { settings: true } }),
  ])
  if (!users.length) return <Empty title={t('register.admin.invitesNone')} />
  const now = new Date()
  const challenges = await db.authChallenge.findMany({ where: { userId: { in: users.map((u) => u.id) }, kind: 'invite' }, select: { userId: true, expiresAt: true } })
  const valid = new Map(challenges.map((c) => [c.userId, c.expiresAt]))
  const unitName = new Map(units.map((u) => [u.id, u.name]))
  const domain = placeholderDomain(org?.settings)
  const isPlaceholder = (email: string) => !!domain && email.endsWith('@' + domain)
  const day = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  return (
    <>
      <div className="row-between">
        <p className="small muted" style={{ margin: 0, maxWidth: '60ch' }}>{t('register.admin.invitesIntro')}</p>
        <InviteLinks ids={users.map((u) => u.id)} label={t('register.admin.generateAll', { n: users.length })} className="btn primary" replaces={users.some((u) => (valid.get(u.id) ?? now) > now)} days={INVITE_DAYS} />
      </div>
      {users.some((u) => isPlaceholder(u.email)) && <p className="alert warn" style={{ margin: 0 }}>{t('register.admin.placeholderHint', { domain: domain! })}</p>}
      <section className="card" aria-label={t('register.admin.tabs.invites')}>
        <ul className="list">
          {users.map((u) => {
            const exp = valid.get(u.id)
            const meta = [u.jobTitle, u.primaryUnitId ? unitName.get(u.primaryUnitId) : null].filter(Boolean).join(' · ')
            return (
              <li key={u.id}>
                <div className="li inv-row">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link href={`/admin/users/${u.id}`} className="linkbtn">{u.lastName} {u.firstName}</Link>
                    <div className="small muted">{u.email}{isPlaceholder(u.email) && <> <span className="tag warn">{t('register.admin.placeholder')}</span></>}</div>
                    <div className="small inv-meta">
                      {meta && <span className="fg2">{meta}</span>}
                      {!exp ? <span className="muted">{t('register.admin.linkNone')}</span>
                        : exp > now ? <span className="tag ok">{t('register.admin.linkValid', { date: day(exp) })}</span>
                        : <span className="tag">{t('register.admin.linkExpired')}</span>}
                    </div>
                  </div>
                  <InviteLinks ids={[u.id]} label={t('register.admin.generateOne')} className="btn sm" replaces={!!exp && exp > now} days={INVITE_DAYS} />
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

/** Admin → Benutzer → Anfragen: Konten aus der Selbstregistrierung freigeben oder ablehnen. */
export async function RequestsTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const [users, roles, units] = await Promise.all([
    db.user.findMany({ where: { orgId: ctx.org.id, pendingSince: { not: null } }, select: { id: true, firstName: true, lastName: true, email: true, pendingSince: true, registration: true }, orderBy: { pendingSince: 'asc' } }),
    db.role.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.unit.findMany({ where: { orgId: ctx.org.id }, include: { location: true }, orderBy: { name: 'asc' } }),
  ])
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const noteOf = (r: unknown) => (r && typeof r === 'object' && typeof (r as { note?: unknown }).note === 'string' ? (r as { note: string }).note : '')
  return (
    <>
      <p className="small muted" style={{ margin: 0, maxWidth: '70ch' }}>{t('register.admin.requestsHint')}</p>
      {users.length ? (
        <section className="card" aria-label={t('register.admin.tabs.requests')}><ul className="list">
          {users.map((u) => {
            const note = noteOf(u.registration)
            const who = <span><strong>{u.firstName} {u.lastName}</strong> · {u.email}</span>
            return (
              <li key={u.id}>
                <div className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div><strong>{u.lastName} {u.firstName}</strong></div>
                    <div className="small muted">{u.email} · {t('register.admin.requested')} {rel(u.pendingSince!)}</div>
                    {note && <div className="small">{t('register.admin.noteLabel')}: {note}</div>}
                  </div>
                  <div className="row">
                    <ActBtn action={rejectRequestAction.bind(null, u.id)} className="btn sm danger" confirm="register.admin.rejectConfirm" context={who} confirmLabel={t('register.admin.reject')}>{t('register.admin.reject')}</ActBtn>
                    <FormDialog label={t('register.admin.approve')} buttonClass="btn sm primary" title={t('register.admin.approveTitle')} action={approveRequestAction} submit={t('register.admin.approve')} success="register.admin.approved">
                      <input type="hidden" name="id" value={u.id} />
                      <p className="dlg-context" style={{ margin: 0 }}>{who}</p>
                      <div className="form-grid">
                        <Select label={t('register.admin.role')} name="roleId" defaultValue="" required>
                          <option value="" disabled>–</option>
                          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </Select>
                        <Select label={t('register.admin.unit')} name="unitId" defaultValue="" required>
                          <option value="" disabled>–</option>
                          {units.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.location.name}</option>)}
                        </Select>
                        <TextField label={t('register.admin.jobTitle')} wrapClassName="span-all" name="jobTitle" defaultValue={note} maxLength={80} optional />
                      </div>
                    </FormDialog>
                  </div>
                </div>
              </li>
            )
          })}
        </ul></section>
      ) : <Empty title={t('register.admin.requestsNone')} />}
    </>
  )
}

/** Admin → Benutzer → Registrierung: Selbstregistrierung ein/aus, Code anzeigen und erneuern. */
export async function RegistrationTab({ ctx }: { ctx: Ctx }) {
  const { t, locale } = ctx
  const org = await db.organization.findUnique({ where: { id: ctx.org.id }, select: { settings: true } })
  const reg = readRegistration(org?.settings)
  const code = registrationCode(org?.settings)
  const url = new URL('/register', env.appUrl).toString()
  return (
    <section className="card" aria-labelledby="reg-h">
      <div className="card-head"><h2 id="reg-h">{t('register.admin.regTitle')}</h2>{reg.enabled ? <span className="tag ok">{t('register.admin.regOn')}</span> : <span className="tag">{t('register.admin.regOff')}</span>}</div>
      <div className="card-body stack-sm">
        <p style={{ margin: 0, maxWidth: '70ch' }}>{t('register.admin.regIntro')}</p>
        <dl className="kv">
          <dt>{t('register.admin.regAddress')}</dt>
          <dd className="row" style={{ gap: 8 }}><code className="mono">{url}</code><CopyBtn value={url} /></dd>
          {code && (
            <>
              <dt>{t('register.admin.code')}</dt>
              <dd className="row" style={{ gap: 8 }}>
                <code className="mono reg-code">{code}</code><CopyBtn value={code} />
                {reg.rotatedAt && <span className="small muted">{t('register.admin.rotatedAt')} {fmtDate(new Date(reg.rotatedAt), locale, { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>}
              </dd>
            </>
          )}
        </dl>
        <p className="small muted" style={{ margin: 0, maxWidth: '70ch' }}>{t('register.admin.codeHint')}</p>
      </div>
      <div className="card-foot row">
        {reg.enabled
          ? <ActBtn action={setRegistrationAction.bind(null, false)} className="btn">{t('register.admin.disable')}</ActBtn>
          : <ActBtn action={setRegistrationAction.bind(null, true)} className="btn primary">{t('register.admin.enable')}</ActBtn>}
        {code && <ActBtn action={rotateRegistrationCodeAction} className="btn" confirm="register.admin.rotateConfirm" confirmLabel={t('register.admin.rotate')}>{t('register.admin.rotate')}</ActBtn>}
      </div>
    </section>
  )
}
