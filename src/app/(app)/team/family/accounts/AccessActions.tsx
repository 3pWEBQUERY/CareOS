'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { CheckboxGroup, DateField, NumberField, RadioGroup, Switch, TextField, Textarea } from '@/components/ui/fields'
import { PORTAL_GRANTS } from '@/lib/portal/policy'
import { lockAccountAction, revokeAccessTeamAction, savePortalSettingsAction, setFileSharedAction, setGrantsAction } from '../actions'

export type FileRow = { id: string; title: string; category: string; shared: boolean; shareable: boolean }

export function AccessActions({ access, context, files, today, canManage }: {
  access: { id: string; accountId: string | null; grants: string[]; consentScope: string[]; locked: boolean; revoked: boolean; consentName: string }
  context: string
  files: FileRow[]
  today: string
  canManage: boolean
}) {
  const t = useT()
  const [dlg, setDlg] = useState<null | 'grants' | 'files' | 'revoke' | 'lock'>(null)
  const [sel, setSel] = useState<string[]>(access.grants)
  const extendsConsent = sel.some((g) => !access.consentScope.includes(g))
  if (!canManage || access.revoked) return null
  const close = () => setDlg(null)
  const ctxNode = <span><strong>{context}</strong></span>
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <button type="button" className="linkbtn small" onClick={() => { setSel(access.grants); setDlg('grants') }}>{t('portal.team.editGrants')}</button>
      <button type="button" className="linkbtn small" onClick={() => setDlg('files')}>{t('portal.team.files')}</button>
      {access.accountId && <button type="button" className="linkbtn small" onClick={() => setDlg('lock')}>{t(access.locked ? 'portal.team.unlock' : 'portal.team.lock')}</button>}
      <button type="button" className="linkbtn small crit-text" onClick={() => setDlg('revoke')}>{t('portal.contact.revoke')}</button>

      <Dialog open={dlg === 'grants'} onClose={close} title={t('portal.team.editGrants')} context={ctxNode}>
        {dlg === 'grants' && (
          <ActionForm action={setGrantsAction.bind(null, access.id)} onDone={(r) => r.ok && close()} success="common.saved">
            <GrantChecks value={sel} onChange={setSel} consent={access.consentScope} />
            {extendsConsent ? (
              <fieldset className="portal-consent">
                <legend className="lbl">{t('portal.team.newConsent')}</legend>
                <p className="small fg2" style={{ margin: 0 }}>{t('portal.team.newConsentHint')}</p>
                <div className="form-grid">
                  <RadioGroup label={t('portal.invite.consentBy')} name="consentBy" required options={[{ value: 'resident', label: t('portal.consentBy.resident') }, { value: 'legal_rep', label: t('portal.consentBy.legal_rep') }]} wrapClassName="span-all" />
                  <TextField label={t('portal.invite.consentName')} name="consentName" required maxLength={120} defaultValue={access.consentName} />
                  <DateField label={t('portal.invite.consentAt')} name="consentAt" required defaultValue={today} max={today} />
                  <Textarea label={t('portal.invite.consentNote')} name="consentNote" optional rows={2} maxLength={500} wrapClassName="span-all" />
                </div>
              </fieldset>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('portal.team.withinConsent')}</p>}
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>

      <Dialog open={dlg === 'files'} onClose={close} title={t('portal.team.filesTitle')} context={ctxNode}>
        {dlg === 'files' && (
          <div className="stack">
            <p className="small fg2" style={{ margin: 0 }}>{t('portal.team.filesHint')}</p>
            {!access.grants.includes('files') && <div className="alert warn"><span className="grow">{t('portal.team.filesNoGrant')}</span></div>}
            {files.length ? (
              <ul className="list">
                {files.map((f) => (
                  <li key={f.id}><div className="li">
                    <div className="grow"><div>{f.title}</div><div className="small muted">{t('residents.files.cat.' + f.category)}{!f.shareable && ' · ' + t('portal.team.fileClinical')}</div></div>
                    <FileSwitch f={f} />
                  </div></li>
                ))}
              </ul>
            ) : <p className="empty">{t('portal.team.noFiles')}</p>}
            <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={close}>{t('common.close')}</button></div>
          </div>
        )}
      </Dialog>

      <Dialog open={dlg === 'lock'} onClose={close} title={t(access.locked ? 'portal.team.unlock' : 'portal.team.lockTitle')} context={ctxNode}>
        {dlg === 'lock' && access.accountId && (
          <ActionForm action={lockAccountAction.bind(null, access.accountId, !access.locked)} onDone={(r) => r.ok && close()}>
            <p className="small fg2" style={{ margin: 0 }}>{t(access.locked ? 'portal.team.unlockText' : 'portal.team.lockText')}</p>
            {!access.locked && <Textarea label={t('portal.revoke.reason')} name="reason" optional rows={2} maxLength={300} />}
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <button type="submit" className={'btn ' + (access.locked ? 'primary' : 'danger solid')}>{t(access.locked ? 'portal.team.unlock' : 'portal.team.lock')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>

      <Dialog open={dlg === 'revoke'} onClose={close} title={t('portal.revoke.title')} context={ctxNode}>
        {dlg === 'revoke' && (
          <ActionForm action={revokeAccessTeamAction.bind(null, access.id)} onDone={(r) => r.ok && close()}>
            <p className="small fg2" style={{ margin: 0 }}>{t('portal.revoke.text')}</p>
            <Textarea label={t('portal.revoke.reason')} name="reason" optional rows={2} maxLength={300} />
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <button type="submit" className="btn danger solid">{t('portal.revoke.submit')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>
    </div>
  )
}

/** Datei freigeben – optimistisch, bei Fehler zurück mit Hinweis. */
function FileSwitch({ f }: { f: FileRow }) {
  const t = useT()
  const [on, setOn] = useState(f.shared)
  const [pending, start] = useTransition()
  return (
    <Switch aria-label={`${t('portal.team.share')}: ${f.title}`} checked={on} disabled={pending || (!f.shareable && !on)}
      onChange={(e) => {
        const next = e.currentTarget.checked
        setOn(next)
        start(async () => {
          const r = await setFileSharedAction(f.id, next)
          if (!r.ok) setOn(!next)
          toast(r.ok ? t(r.message ?? 'common.saved') : t(r.error), r.ok ? {} : { kind: 'crit' })
        })
      }} />
  )
}

/** Freigaben mit Kennzeichnung, was über die bisherige Einwilligung hinausgeht. */
function GrantChecks({ value, onChange, consent }: { value: string[]; onChange: (v: string[]) => void; consent: string[] }) {
  const t = useT()
  return (
    <div className="fld fld-group" role="group" aria-labelledby="pg-l">
      <span className="lbl" id="pg-l">{t('portal.team.grants')}</span>
      <div className="fld-opts">
        {PORTAL_GRANTS.map((g) => (
          <Switch key={g} name="grants" value={g} checked={value.includes(g)}
            onChange={(e) => onChange(e.currentTarget.checked ? [...value, g] : value.filter((x) => x !== g))}
            label={t('portal.grants.' + g)} hint={consent.includes(g) ? t('portal.grantHints.' + g) : t('portal.team.outsideConsent')} />
        ))}
      </div>
      <span className="fld-slot" data-err-slot="" />
    </div>
  )
}

export function PortalSettingsForm({ defaults, lead, maxDays }: { defaults: string[]; lead: number; maxDays: number }) {
  const t = useT()
  return (
    <ActionForm action={savePortalSettingsAction} reset={false} success="common.saved">
      <div className="form-grid">
        <CheckboxGroup label={t('portal.team.defaultGrants')} name="defaultGrants" defaultValue={defaults} options={PORTAL_GRANTS.map((g) => ({ value: g, label: t('portal.grants.' + g) }))} wrapClassName="span-all" inline />
        <NumberField label={t('portal.team.visitLead')} name="visitLeadHours" defaultValue={lead} min={0} max={72} step={1} unit="h" />
        <NumberField label={t('portal.team.visitMax')} name="visitMaxDays" defaultValue={maxDays} min={1} max={365} step={1} unit={t('portal.team.days')} />
      </div>
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn">{t('common.save')}</button></div>
    </ActionForm>
  )
}
