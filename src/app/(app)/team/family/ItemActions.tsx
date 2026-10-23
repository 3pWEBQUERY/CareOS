'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { Combobox, RadioGroup, Textarea, type ComboOption } from '@/components/ui/fields'
import { MESSAGE_MAX } from '@/lib/portal/policy'
import { assignThreadAction, assignVisitAction, decideVisitAction, messageToChartAction, replyThreadAction, setThreadStatusAction } from './actions'

export function ThreadReply({ threadId, context }: { threadId: string; context: string }) {
  const t = useT()
  return (
    <ActionForm action={replyThreadAction.bind(null, threadId)}>
      <Textarea label={t('portal.team.reply')} name="body" required rows={4} maxLength={MESSAGE_MAX} hint={t('portal.team.replyHint', { who: context })} />
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn primary">{t('portal.team.send')}</button></div>
    </ActionForm>
  )
}

export function ThreadStatus({ threadId, status }: { threadId: string; status: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const next = status === 'closed' ? 'open' : 'closed'
  return (
    <button type="button" className="btn sm" data-loading={pending} disabled={pending} onClick={() => start(async () => {
      const r = await setThreadStatusAction(threadId, next)
      toast(r.ok ? t(r.message ?? 'common.saved') : t(r.error), r.ok ? {} : { kind: 'crit' })
    })}>{t(next === 'closed' ? 'portal.team.close' : 'portal.team.reopen')}</button>
  )
}

export function AssignForm({ kind, id, value, options }: { kind: 'message' | 'visit'; id: string; value: string; options: ComboOption[] }) {
  const t = useT()
  const action = kind === 'message' ? assignThreadAction.bind(null, id) : assignVisitAction.bind(null, id)
  return (
    <ActionForm action={action} reset={false}>
      <Combobox label={t('portal.team.assignTo')} name="assigneeId" defaultValue={value} options={options} placeholder={t('portal.team.unassigned')} clearable />
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn">{t('portal.team.assign')}</button></div>
    </ActionForm>
  )
}

/** Nachricht in den Verlauf übernehmen: Text vorbefüllt, vor dem Speichern anpassbar (Document Once). */
export function ToChart({ threadId, messageId, text, context, category }: { threadId: string; messageId: string; text: string; context: string; category?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="linkbtn small" onClick={() => setOpen(true)}>{t('portal.team.toChart')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('portal.team.toChartTitle')} context={<span><strong>{context}</strong> · {category ?? t('portal.team.toChartCat')}</span>}>
        {open && (
          <ActionForm action={messageToChartAction.bind(null, threadId, messageId)} onDone={(r) => r.ok && setOpen(false)}>
            <Textarea label={t('portal.team.toChartText')} name="text" required rows={5} maxLength={4000} defaultValue={text} />
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('portal.team.toChartSave')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>
    </>
  )
}

/** Besuch bestätigen oder ablehnen (Ablehnung mit Begründung). */
export function VisitDecision({ visitId, context }: { visitId: string; context: string }) {
  const t = useT()
  const [decision, setDecision] = useState('confirmed')
  return (
    <ActionForm action={decideVisitAction.bind(null, visitId)} confirm={decision === 'declined' ? { title: t('portal.team.declineConfirm'), context: <span>{context}</span>, danger: true } : undefined}>
      <RadioGroup label={t('portal.team.decision')} name="decision" value={decision} onChange={setDecision} inline
        options={[{ value: 'confirmed', label: t('portal.team.confirmVisit') }, { value: 'declined', label: t('portal.team.declineVisit') }]} />
      <Textarea label={t('portal.team.visitReply')} name="reply" rows={3} maxLength={500} optional={decision === 'confirmed'} required={decision === 'declined'}
        hint={decision === 'confirmed' ? t('portal.team.visitReplyHint') : t('portal.team.declineHint')} />
      <div className="form-actions">
        <span className="spacer" />
        <button type="submit" className={'btn ' + (decision === 'confirmed' ? 'primary' : 'danger')}>{t(decision === 'confirmed' ? 'portal.team.confirmVisit' : 'portal.team.declineVisit')}</button>
      </div>
    </ActionForm>
  )
}
