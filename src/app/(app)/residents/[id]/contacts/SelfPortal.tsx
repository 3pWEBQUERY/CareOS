'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useT, useLocale } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { CheckboxGroup, DateField, RadioGroup, TextField, Textarea } from '@/components/ui/fields'
import { INTL_LOCALE } from '@/i18n/core'
import { PORTAL_GRANTS } from '@/lib/portal/policy'
import { inviteSelfPortalAction, reissuePortalInviteAction, revokePortalAccessAction, type InviteResult } from './portal-actions'
import { InviteLink, type AccessRow, type PortalProps } from './ContactPortal'

const STATE_TONE: Record<AccessRow['state'], string> = { invited: 'accent', expired: 'warn', active: 'ok', revoked: '', locked: 'crit' }

/**
 * Bewohnerportal in der Akte (Kontakte): Status des Zugangs der Person selbst, Einladen mit Einwilligung,
 * Link erneuern, Widerrufen. Gleiche Abläufe wie bei Angehörigen (ContactPortal), aber ohne Kontaktperson.
 */
export function SelfPortal({ residentId, who, name, accesses, portal }: {
  residentId: string
  who: string
  name: string
  accesses: AccessRow[]
  portal: PortalProps
}) {
  const t = useT()
  const locale = useLocale()
  const [invite, setInvite] = useState(false)
  const [link, setLink] = useState<InviteResult | null>(null)
  const [revoke, setRevoke] = useState<AccessRow | null>(null)
  const [pending, start] = useTransition()
  const open = accesses.find((a) => a.state !== 'revoked') ?? null
  const earlier = accesses.filter((a) => a.state === 'revoked').length
  const fmt = (iso: string) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  const grantLabel = (g: string) => t('portal.grants.' + g)
  if (!portal.moduleOn && !accesses.length) return null
  const reissue = (a: AccessRow) => start(async () => {
    const r = await reissuePortalInviteAction(residentId, a.id)
    if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
    if (r.data) setLink(r.data)
  })
  const ctxNode = <span><strong>{who}</strong> · {t('residentPortal.record.title')}</span>

  return (
    <section className="card" aria-labelledby="rp-self">
      <div className="card-head">
        <h3 id="rp-self">{name}</h3>
        <span className="muted small">{t('residentPortal.team.self')}</span>
      </div>
      <div className="card-body stack-sm">
        {open ? (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className={'tag ' + STATE_TONE[open.state]}>{t('portal.state.' + open.state)}</span>
              <span className="small muted" style={{ overflowWrap: 'anywhere' }}>{open.inviteEmail}</span>
            </div>
            <p className="small fg2" style={{ margin: 0 }}>{open.grants.map(grantLabel).join(' · ') || '–'}</p>
            <p className="small muted" style={{ margin: 0 }}>
              {t('portal.contact.consent', { name: open.consentName, date: fmt(open.consentAt), by: t('portal.consentBy.' + open.consentBy) })}
              {open.state === 'invited' && open.inviteExpiresAt && <> · {t('portal.contact.until', { date: fmt(open.inviteExpiresAt) })}</>}
              {open.state === 'active' && open.lastLoginAt && <> · {t('portal.contact.lastLogin', { date: fmt(open.lastLoginAt) })}</>}
            </p>
            {portal.canManage && (
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                {(open.state === 'invited' || open.state === 'expired') && portal.moduleOn && (
                  <button type="button" className="linkbtn small" onClick={() => reissue(open)} disabled={pending}>{t('portal.contact.newLink')}</button>
                )}
                {(open.state === 'active' || open.state === 'locked') && <Link className="linkbtn small" href={`/team/family/accounts?resident=${residentId}&who=self`}>{t('portal.contact.manage')}</Link>}
                <button type="button" className="linkbtn small crit-text" onClick={() => setRevoke(open)}>{t('portal.contact.revoke')}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="small fg2" style={{ margin: 0 }}>{t('residentPortal.record.hint')}</p>
            {portal.canManage && portal.moduleOn
              ? <div><button type="button" className="btn sm" onClick={() => setInvite(true)}>{t('residentPortal.record.invite')}</button></div>
              : <span className="small muted">{t('residentPortal.record.none')}</span>}
          </>
        )}
        {earlier > 0 && <span className="small muted">{t('residentPortal.record.history', { n: earlier })}</span>}
      </div>

      <Dialog open={invite} onClose={() => setInvite(false)} title={t('residentPortal.record.inviteTitle')} context={ctxNode}>
        {invite && (
          <ActionForm
            action={inviteSelfPortalAction.bind(null, residentId)}
            onDone={(r) => { if (r.ok && r.data) { setInvite(false); setLink(r.data as InviteResult) } }}
          >
            <p className="small fg2" style={{ margin: 0 }}>{t('residentPortal.record.inviteHint')}</p>
            <div className="form-grid">
              <TextField label={t('portal.invite.name')} name="name" required maxLength={120} defaultValue={name} />
              <TextField label={t('residentPortal.record.email')} name="email" type="email" required maxLength={160} />
            </div>
            <fieldset className="portal-consent">
              <legend className="lbl">{t('portal.invite.consentTitle')}</legend>
              <div className="form-grid">
                <RadioGroup label={t('portal.invite.consentBy')} name="consentBy" required defaultValue="resident" hint={t('residentPortal.record.consentHint')}
                  options={[{ value: 'resident', label: t('portal.consentBy.resident') }, { value: 'legal_rep', label: t('portal.consentBy.legal_rep') }]} wrapClassName="span-all" />
                <TextField label={t('portal.invite.consentName')} name="consentName" required maxLength={120} defaultValue={name} />
                <DateField label={t('portal.invite.consentAt')} name="consentAt" required defaultValue={portal.today} max={portal.today} />
                <CheckboxGroup label={t('portal.invite.scope')} name="grants" defaultValue={portal.defaults} hint={t('portal.invite.scopeHint')} wrapClassName="span-all"
                  options={PORTAL_GRANTS.map((g) => ({ value: g, label: grantLabel(g), hint: t('residentPortal.grantHints.' + g) }))} />
                <Textarea label={t('portal.invite.consentNote')} name="consentNote" optional rows={2} maxLength={500} placeholder={t('portal.invite.consentNotePh')} wrapClassName="span-all" />
              </div>
            </fieldset>
            <p className="small muted" style={{ margin: 0 }}>{t('portal.invite.never')}</p>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setInvite(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('portal.invite.submit')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>

      <Dialog open={!!link} onClose={() => setLink(null)} title={t('portal.link.title')} context={ctxNode}>
        {link && <InviteLink link={link} fmt={fmt} onClose={() => setLink(null)} />}
      </Dialog>

      <Dialog open={!!revoke} onClose={() => setRevoke(null)} title={t('portal.revoke.title')} context={ctxNode}>
        {revoke && (
          <ActionForm action={revokePortalAccessAction.bind(null, residentId, revoke.id)} onDone={(r) => r.ok && setRevoke(null)}>
            <p className="small fg2" style={{ margin: 0 }}>{t('portal.revoke.text')}</p>
            <Textarea label={t('portal.revoke.reason')} name="reason" optional rows={2} maxLength={300} />
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setRevoke(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn danger solid">{t('portal.revoke.submit')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>
    </section>
  )
}
