'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { Combobox, DateField, Select, TextField } from '@/components/ui/fields'
import { CopyBtn } from '../users/InviteLinks'
import { assignAction, createExternalAction, endAssignmentAction, importFromTextAction, inviteExternalAction, setExternalActiveAction } from './actions'

function LinkBox({ link, days }: { link: string; days: number }) {
  const t = useT()
  return (
    <div className="stack-sm">
      <div className="alert ok" role="status"><span className="grow">{t('md.admin.created')}</span></div>
      <TextField label={t('md.admin.link')} hint={t('md.admin.linkHint', { days })} value={link} readOnly className="mono" onFocus={(e) => e.currentTarget.select()} />
      <div className="row"><CopyBtn value={link} className="btn primary" /></div>
    </div>
  )
}

/** Create: externes Konto mit Einladungslink */
export function CreateExternal({ days }: { days: number }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState<{ id: string; link: string } | null>(null)
  const close = () => { setOpen(false); if (res) router.push(`/admin/physicians/${res.id}`); setRes(null) }
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('md.admin.new')}</button>
      {open && (
        <Dialog open onClose={close} title={t('md.admin.new')}>
          {res ? (
            <>
              <LinkBox link={res.link} days={days} />
              <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={close}>{t('common.close')}</button></div>
            </>
          ) : (
            <ActionForm action={createExternalAction} onDone={(r) => { if (r.ok && r.data) setRes(r.data as { id: string; link: string }) }}>
              <div className="form-grid">
                <TextField label={t('md.admin.firstName')} name="firstName" required maxLength={60} autoComplete="off" />
                <TextField label={t('md.admin.lastName')} name="lastName" required maxLength={60} autoComplete="off" />
                <TextField label={t('md.admin.email')} type="email" name="email" required maxLength={160} autoComplete="off" wrapClassName="span-all" />
                <TextField label={t('md.admin.jobTitle')} optional name="jobTitle" maxLength={80} placeholder={t('md.admin.jobTitlePh')} />
                <TextField label={t('md.admin.phone')} optional type="tel" name="phone" maxLength={40} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>{t('md.admin.sub')}</p>
              <div className="form-actions">
                <span className="spacer" />
                <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
                <button type="submit" className="btn primary">{t('md.admin.create')}</button>
              </div>
            </ActionForm>
          )}
        </Dialog>
      )}
    </>
  )
}

export function ExternalAccountActions({ userId, active, days }: { userId: string; active: boolean; days: number }) {
  const t = useT()
  const [ask, dialog] = useConfirm()
  const [pending, start] = useTransition()
  const [link, setLink] = useState<string | null>(null)
  const invite = () => start(async () => {
    const r = await inviteExternalAction(userId)
    if (r.ok && r.data) setLink(r.data.link)
    else if (!r.ok) toast(t(r.error), { kind: 'crit' })
  })
  const toggle = async () => {
    if (active && !(await ask({ ...splitQuestion(t('md.admin.detail.deactivateQ')), danger: true, confirmLabel: t('md.admin.detail.deactivate') }))) return
    start(async () => {
      const r = await setExternalActiveAction(userId, !active)
      toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' })
    })
  }
  return (
    <>
      <button type="button" className="btn" onClick={invite} disabled={pending}>{t('md.admin.detail.newLink')}</button>
      <button type="button" className={'btn' + (active ? ' danger' : '')} onClick={() => void toggle()} disabled={pending}>{t(active ? 'md.admin.detail.deactivate' : 'md.admin.detail.activate')}</button>
      {link && (
        <Dialog open onClose={() => setLink(null)} title={t('md.admin.link')}>
          <LinkBox link={link} days={days} />
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setLink(null)}>{t('common.close')}</button></div>
        </Dialog>
      )}
      {dialog}
    </>
  )
}

/** Assign: Person zuordnen */
export function AssignForm({ userId, residents, todayKey }: { userId: string; residents: { value: string; label: string; hint: string }[]; todayKey: string }) {
  const t = useT()
  return (
    <ActionForm action={assignAction} className="form md-assign">
      <input type="hidden" name="userId" value={userId} />
      <div className="form-grid">
        <Combobox label={t('md.admin.detail.resident')} name="residentId" required options={residents} wrapClassName="span-all" />
        <Select label={t('md.admin.detail.role')} name="role" defaultValue="primary">
          <option value="primary">{t('md.admin.roles.primary')}</option>
          <option value="consultant">{t('md.admin.roles.consultant')}</option>
        </Select>
        <DateField label={t('md.admin.detail.until')} optional name="until" min={todayKey} />
      </div>
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn primary">{t('md.admin.detail.add')}</button></div>
    </ActionForm>
  )
}

export function EndAssignment({ id, name }: { id: string; name: string }) {
  const t = useT()
  const [ask, dialog] = useConfirm()
  const [pending, start] = useTransition()
  const go = async () => {
    if (!(await ask({ ...splitQuestion(t('md.admin.detail.endQ', { name })), danger: true, confirmLabel: t('md.admin.detail.end'), context: <span>{name}</span> }))) return
    start(async () => {
      const r = await endAssignmentAction(id)
      toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' })
    })
  }
  return <><button type="button" className="btn sm danger" onClick={() => void go()} disabled={pending} aria-label={`${t('md.admin.detail.end')}: ${name}`}>{t('md.admin.detail.end')}</button>{dialog}</>
}

export function ImportFromText({ userId, label }: { userId: string; label: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn" disabled={pending} data-loading={pending || undefined} onClick={() => start(async () => {
      const r = await importFromTextAction(userId)
      toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' })
    })}>{label}</button>
  )
}
