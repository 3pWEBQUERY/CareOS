'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { ActionForm } from '@/components/ui/ActionForm'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { DateField, NumberField, Textarea, TimeField } from '@/components/ui/fields'
import { VISIT_MAX_VISITORS } from '@/lib/portal/policy'
import { cancelVisitAction, requestVisitAction } from '../actions'

export function VisitForm({ min, max, cancelHref }: { min: string; max: string; cancelHref: string | null }) {
  const t = useT()
  const router = useRouter()
  return (
    <ActionForm action={requestVisitAction} onDone={(r) => { if (r.ok) router.push('/portal/visits') }}>
      <div className="form-grid">
        <DateField label={t('portal.visits.date')} name="date" required min={min} max={max} />
        <div className="portal-times">
          <TimeField label={t('portal.visits.from')} name="from" required step={900} quick={false} defaultValue="14:00" />
          <TimeField label={t('portal.visits.to')} name="to" required step={900} quick={false} defaultValue="15:00" />
        </div>
        <NumberField label={t('portal.visits.visitors')} name="visitors" required min={1} max={VISIT_MAX_VISITORS} step={1} defaultValue={1} />
        <Textarea label={t('portal.visits.note')} name="note" optional rows={2} maxLength={500} placeholder={t('portal.visits.notePh')} wrapClassName="span-all" />
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('portal.visits.confirmHint')}</p>
      <div className="form-actions">
        <span className="spacer" />
        {cancelHref && <Link className="btn" href={cancelHref}>{t('common.cancel')}</Link>}
        <button type="submit" className="btn primary">{t('portal.visits.submit')}</button>
      </div>
    </ActionForm>
  )
}

export function CancelVisit({ id, when }: { id: string; when: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [ask, dialog] = useConfirm()
  const go = async () => {
    if (!(await ask({ title: t('portal.visits.cancelConfirm'), context: <span>{when}</span>, confirmLabel: t('portal.visits.cancel'), danger: true }))) return
    start(async () => {
      const r = await cancelVisitAction(id)
      toast(r.ok ? t(r.message ?? 'common.saved') : t(r.error), r.ok ? {} : { kind: 'crit' })
    })
  }
  return (
    <>
      <button type="button" className="btn sm" onClick={go} data-loading={pending} disabled={pending}>{t('portal.visits.cancel')}</button>
      {dialog}
    </>
  )
}
