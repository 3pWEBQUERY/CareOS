'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { ResidentContext } from '@/components/meds/shared'
import type { ResidentCtxDto } from '@/components/meds/types'
import { Combobox, DateField, NumberField, SegmentedControl, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'
import { DISCIPLINES, SESSION_OUTCOMES } from '@/lib/therapy'
import { createPlanAction, documentSessionAction, reviewPlanAction, scheduleSessionAction } from './actions'

export type PlanCtxDto = { id: string; discipline: string; goal: string; sessionMin: number; resident: ResidentCtxDto }

function Actions({ onClose, label }: { onClose: () => void; label: string }) {
  const t = useT()
  return (
    <div className="form-actions">
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
      <button type="submit" className="btn primary">{label}</button>
    </div>
  )
}

/** Create: neuer Therapieplan (optional aus einem Visitenauftrag, dann Person und Disziplin vorgegeben). */
export function PlanButton({ residents, todayKey, reviewKey, order, className = 'btn primary' }: {
  residents: { id: string; name: string; hint: string }[]
  todayKey: string
  reviewKey: string
  order?: { id: string; residentId: string; text: string }
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [care, setCare] = useState('')
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{t(order ? 'therapy.actions.fromOrder' : 'therapy.newPlan')}</button>
      {open && (
        <Dialog open onClose={close} title={t('therapy.newPlan')} wide>
          <ActionForm action={createPlanAction} onDone={(r) => r.ok && close()}>
            {order && <><input type="hidden" name="orderId" value={order.id} /><div className="alert info"><span className="grow">{t('therapy.form.fromOrder', { text: order.text })}</span></div></>}
            {!order && <input type="hidden" name="orderId" value="" />}
            <div className="form-grid">
              {order ? <input type="hidden" name="residentId" value={order.residentId} /> : (
                <Combobox label={t('therapy.form.resident')} name="residentId" required wrapClassName="span-all" placeholder={t('therapy.residentPh')} options={residents.map((r) => ({ value: r.id, label: r.name, hint: r.hint }))} />
              )}
              <Select label={t('therapy.form.discipline')} name="discipline" required defaultValue="physio">
                {DISCIPLINES.map((d) => <option key={d} value={d}>{t('therapy.disciplines.' + d)}</option>)}
              </Select>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-end' }}>
                <NumberField label={t('therapy.form.perWeek')} name="perWeek" min={1} max={14} step={1} defaultValue={2} required wrapStyle={{ flex: 1 }} />
                <NumberField label={t('therapy.form.sessionMin')} name="sessionMin" min={10} max={120} step={5} defaultValue={30} unit={t('therapy.form.unit')} required wrapStyle={{ flex: 1 }} />
              </div>
              <Textarea label={t('therapy.form.goal')} name="goal" required rows={2} maxLength={1000} placeholder={t('therapy.form.goalPh')} wrapClassName="span-all" />
              <DateField label={t('therapy.form.startDate')} name="startDate" defaultValue={todayKey} required />
              <DateField label={t('therapy.form.reviewAt')} name="reviewAt" defaultValue={reviewKey} min={todayKey} required />
              <DateField label={t('therapy.form.endDate')} name="endDate" optional min={todayKey} />
              <TextField label={t('therapy.form.careInstructions')} optional name="careInstructions" maxLength={200} hint={t('therapy.form.careInstructionsHint')} wrapClassName="span-all" onChange={(e) => setCare(e.target.value)} />
              {care.trim() && <TimeField label={t('therapy.form.careTime')} name="careTime" required step={900} />}
              {!care.trim() && <input type="hidden" name="careTime" value="" />}
            </div>
            <Actions onClose={close} label={t('therapy.form.save')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Einheit planen (Termin) */
export function ScheduleButton({ plan, todayKey }: { plan: PlanCtxDto; todayKey: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('therapy.actions.schedule')}</button>
      {open && (
        <Dialog open onClose={close} title={t('therapy.form.scheduleTitle')} context={<ResidentContext r={plan.resident} />}>
          <ActionForm action={scheduleSessionAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="planId" value={plan.id} />
            <p className="small fg2" style={{ margin: 0 }}>{t('therapy.disciplines.' + plan.discipline)} · {plan.goal}</p>
            <div className="form-grid">
              <DateField label={t('therapy.form.date')} name="date" defaultValue={todayKey} min={todayKey} required />
              <TimeField label={t('therapy.form.time')} name="time" step={900} required />
            </div>
            <Actions onClose={close} label={t('therapy.actions.schedule')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Complete: Einheit dokumentieren (Bericht) oder Ausfall mit Grund */
export function DocumentButton({ plan, appointmentId, className = 'btn sm primary' }: { plan: PlanCtxDto; appointmentId?: string | null; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<string>('done')
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{t('therapy.actions.document')}</button>
      {open && (
        <Dialog open onClose={close} title={t('therapy.form.documentTitle')} context={<ResidentContext r={plan.resident} />} wide>
          <ActionForm action={documentSessionAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="appointmentId" value={appointmentId ?? ''} />
            <p className="small fg2" style={{ margin: 0 }}>{t('therapy.disciplines.' + plan.discipline)} · {t('therapy.goalLine', { goal: plan.goal })}</p>
            <SegmentedControl name="outcome" aria-label={t('therapy.form.outcome')} value={outcome} onChange={setOutcome}
              options={SESSION_OUTCOMES.map((o) => ({ value: o, label: t('therapy.outcome.' + o) }))} />
            {outcome === 'done'
              ? <NumberField label={t('therapy.form.duration')} name="durationMin" min={5} max={240} step={5} defaultValue={plan.sessionMin} unit={t('therapy.form.unit')} required wrapStyle={{ maxWidth: '12rem' }} />
              : <input type="hidden" name="durationMin" value="0" />}
            <Textarea label={t(outcome === 'done' ? 'therapy.form.report' : outcome === 'other' ? 'therapy.form.reason' : 'therapy.form.optionalReason')} optional={outcome !== 'done' && outcome !== 'other'} required={outcome === 'done' || outcome === 'other'}
              name="text" rows={4} maxLength={4000} autoGrow placeholder={outcome === 'done' ? t('therapy.form.reportPh') : undefined} />
            <Actions onClose={close} label={t('therapy.actions.document')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Review: Zielevaluation */
export function ReviewButton({ plan, nextKey, todayKey }: { plan: PlanCtxDto; nextKey: string; todayKey: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [decision, setDecision] = useState('continue')
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('therapy.actions.review')}</button>
      {open && (
        <Dialog open onClose={close} title={t('therapy.form.reviewTitle')} context={<ResidentContext r={plan.resident} />} wide>
          <ActionForm action={reviewPlanAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="planId" value={plan.id} />
            <p className="small fg2" style={{ margin: 0 }}>{t('therapy.disciplines.' + plan.discipline)} · {t('therapy.goalLine', { goal: plan.goal })}</p>
            <SegmentedControl name="decision" aria-label={t('therapy.form.decision')} value={decision} onChange={setDecision}
              options={(['continue', 'completed', 'stopped'] as const).map((d) => ({ value: d, label: t('therapy.form.decisions.' + d) }))} />
            <Textarea label={t('therapy.form.outcomeText')} name="outcome" required rows={3} maxLength={2000} placeholder={t('therapy.form.outcomePh')} />
            {decision === 'continue'
              ? <DateField label={t('therapy.form.nextReview')} name="nextReview" defaultValue={nextKey} min={todayKey} required />
              : <input type="hidden" name="nextReview" value="" />}
            <Actions onClose={close} label={t('therapy.form.reviewSave')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}
