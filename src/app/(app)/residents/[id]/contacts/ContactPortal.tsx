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
import { invitePortalAction, reissuePortalInviteAction, revokePortalAccessAction, type InviteResult } from './portal-actions'

export type AccessRow = {
  id: string
  role: string
  state: 'invited' | 'expired' | 'active' | 'revoked' | 'locked'
  grants: string[]
  consentBy: string
  consentName: string
  consentAt: string
  inviteEmail: string
  inviteExpiresAt: string | null
  lastLoginAt: string | null
  revokedAt: string | null
}

export type PortalProps = {
  canManage: boolean
  moduleOn: boolean
  defaults: string[]
  today: string
  legalRep: string | null
}

const STATE_TONE: Record<AccessRow['state'], string> = { invited: 'accent', expired: 'warn', active: 'ok', revoked: '', locked: 'crit' }

/** Portal-Zugänge einer Kontaktperson in der Kontaktkarte: Status, Freigaben, Einladen, Link erneuern, Widerrufen. */
export function ContactPortal({ residentId, who, contact, accesses, portal }: {
  residentId: string
  who: string
  contact: { id: string; name: string; email: string | null; isLegalRep: boolean }
  accesses: AccessRow[]
  portal: PortalProps
}) {
  const t = useT()
  const locale = useLocale()
  const [invite, setInvite] = useState(false)
  const [link, setLink] = useState<InviteResult | null>(null)
  const [revoke, setRevoke] = useState<AccessRow | null>(null)
  const [pending, start] = useTransition()
  const open = accesses.filter((a) => a.state !== 'revoked')
  const fmt = (iso: string) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  const grantLabel = (g: string) => t('portal.grants.' + g)

  if (!portal.moduleOn && !accesses.length) return null
  const reissue = (a: AccessRow) => start(async () => {
    const r = await reissuePortalInviteAction(residentId, a.id)
    if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
    if (r.data) setLink(r.data)
  })

  return (
    <div className="stack-sm portal-contact">
      <span className="lbl">{t('portal.contact.title')}</span>
      {open.map((a) => (
        <div key={a.id} className="stack-sm">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className={'tag ' + STATE_TONE[a.state]}>{t('portal.state.' + a.state)}</span>
            {a.role === 'legal_rep' && <span className="tag violet">{t('portal.roles.legal_rep')}</span>}
            <span className="small muted" style={{ overflowWrap: 'anywhere' }}>{a.inviteEmail}</span>
          </div>
          <p className="small fg2" style={{ margin: 0 }}>
            {a.grants.map(grantLabel).join(' · ') || '–'}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('portal.contact.consent', { name: a.consentName, date: fmt(a.consentAt), by: t('portal.consentBy.' + a.consentBy) })}
            {a.state === 'invited' && a.inviteExpiresAt && <> · {t('portal.contact.until', { date: fmt(a.inviteExpiresAt) })}</>}
            {a.state === 'active' && a.lastLoginAt && <> · {t('portal.contact.lastLogin', { date: fmt(a.lastLoginAt) })}</>}
          </p>
          {portal.canManage && (
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {(a.state === 'invited' || a.state === 'expired') && portal.moduleOn && (
                <button type="button" className="linkbtn small" onClick={() => reissue(a)} disabled={pending}>{t('portal.contact.newLink')}</button>
              )}
              {(a.state === 'active' || a.state === 'locked') && <Link className="linkbtn small" href={`/team/family/accounts?resident=${residentId}`}>{t('portal.contact.manage')}</Link>}
              <button type="button" className="linkbtn small crit-text" onClick={() => setRevoke(a)}>{t('portal.contact.revoke')}</button>
            </div>
          )}
        </div>
      ))}
      {!open.length && portal.canManage && portal.moduleOn && (
        <button type="button" className="btn sm" onClick={() => setInvite(true)}>{t('portal.contact.invite')}</button>
      )}
      {!open.length && (!portal.canManage || !portal.moduleOn) && <span className="small muted">{t('portal.contact.none')}</span>}

      <Dialog open={invite} onClose={() => setInvite(false)} title={t('portal.invite.title')} context={<span><strong>{who}</strong> · {contact.name}</span>}>
        {invite && (
          <ActionForm
            action={invitePortalAction.bind(null, residentId, contact.id)}
            onDone={(r) => { if (r.ok && r.data) { setInvite(false); setLink(r.data as InviteResult) } }}
          >
            <p className="small fg2" style={{ margin: 0 }}>{t('portal.invite.hint')}</p>
            <div className="form-grid">
              <TextField label={t('portal.invite.name')} name="name" required maxLength={120} defaultValue={contact.name} />
              <TextField label={t('portal.invite.email')} name="email" type="email" required maxLength={160} defaultValue={contact.email ?? ''} hint={!contact.email ? t('portal.invite.emailHint') : undefined} />
              <RadioGroup label={t('portal.invite.role')} name="role" inline defaultValue={contact.isLegalRep ? 'legal_rep' : 'relative'} options={[{ value: 'relative', label: t('portal.roles.relative') }, { value: 'legal_rep', label: t('portal.roles.legal_rep') }]} wrapClassName="span-all" />
            </div>
            <fieldset className="portal-consent">
              <legend className="lbl">{t('portal.invite.consentTitle')}</legend>
              <div className="form-grid">
                <RadioGroup label={t('portal.invite.consentBy')} name="consentBy" required defaultValue={portal.legalRep ? 'legal_rep' : 'resident'} options={[{ value: 'resident', label: t('portal.consentBy.resident') }, { value: 'legal_rep', label: t('portal.consentBy.legal_rep') }]} wrapClassName="span-all" />
                <TextField label={t('portal.invite.consentName')} name="consentName" required maxLength={120} defaultValue={portal.legalRep ?? ''} hint={t('portal.invite.consentNameHint')} />
                <DateField label={t('portal.invite.consentAt')} name="consentAt" required defaultValue={portal.today} max={portal.today} />
                <CheckboxGroup label={t('portal.invite.scope')} name="grants" defaultValue={portal.defaults} hint={t('portal.invite.scopeHint')} wrapClassName="span-all"
                  options={PORTAL_GRANTS.map((g) => ({ value: g, label: grantLabel(g), hint: t('portal.grantHints.' + g) }))} />
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

      <Dialog open={!!link} onClose={() => setLink(null)} title={t('portal.link.title')} context={<span><strong>{who}</strong> · {contact.name}</span>}>
        {link && <InviteLink link={link} fmt={fmt} onClose={() => setLink(null)} />}
      </Dialog>

      <Dialog open={!!revoke} onClose={() => setRevoke(null)} title={t('portal.revoke.title')} context={<span><strong>{who}</strong> · {revoke?.inviteEmail}</span>}>
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
    </div>
  )
}

/** Einladungslink anzeigen und kopieren (ohne Mail-Adapter der einzige Weg). */
export function InviteLink({ link, fmt, onClose }: { link: InviteResult; fmt: (iso: string) => string; onClose: () => void }) {
  const t = useT()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url)
      toast(t('portal.link.copied'))
    } catch {
      toast(t('portal.link.copyFailed'), { kind: 'crit' })
    }
  }
  return (
    <div className="stack">
      {link.mailed ? <div className="alert ok"><span className="grow">{t('portal.link.mailed')}</span></div> : <p className="small fg2" style={{ margin: 0 }}>{t('portal.link.hint')}</p>}
      <TextField label={t('portal.link.label')} value={link.url} readOnly className="mono" hint={t('portal.link.until', { date: fmt(link.expiresAt) })} onFocus={(e) => e.currentTarget.select()} />
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        <button type="button" className="btn primary" onClick={copy}>{t('portal.link.copy')}</button>
      </div>
    </div>
  )
}
