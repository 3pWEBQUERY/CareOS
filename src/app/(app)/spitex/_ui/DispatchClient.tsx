'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { Tooltip } from '@/components/ui/Tooltip'
import { Combobox, DateField, Select, Textarea, TimeField } from '@/components/ui/fields'
import { ActButton } from '@/app/(app)/team/_ui/ActButton'
import { assignVisitAction, cancelVisitAction, moveVisitAction, saveVisitAction } from '../actions'
import { ServiceRows, type ServiceDto } from './ServiceRows'

export type Opt = { id: string; label: string; hint?: string }
export type VisitDto = {
  id: string; residentId: string; date: string; start: string; end: string; assigneeId: string | null; note: string | null
  fromTemplate: boolean; services: ServiceDto[]
}

function Actions({ onClose, label, extra }: { onClose: () => void; label: string; extra?: React.ReactNode }) {
  const t = useT()
  return (
    <div className="form-actions">
      {extra}
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
      <button type="submit" className="btn primary">{label}</button>
    </div>
  )
}

/** Einsatz planen (neu) oder ändern; Absagen im selben Dialog. */
export function VisitButton({ clients, staff, day, today, maxDay, visit, assigneeId, className = 'btn primary', label }: {
  clients: Opt[]
  staff: Opt[]
  day: string
  today: string
  maxDay: string
  visit?: VisitDto
  /** Vorbelegung «zuweisen an» beim Planen aus einer Tour */
  assigneeId?: string
  className?: string
  label?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={visit ? t('spitex.actions.editNamed', { name: clients.find((c) => c.id === visit.residentId)?.label ?? '' }) : undefined}>
        {label ?? t(visit ? 'spitex.actions.edit' : 'spitex.actions.newVisit')}
      </button>
      {open && (
        <Dialog open onClose={close} title={t(visit ? 'spitex.form.editVisit' : 'spitex.form.newVisit')} wide>
          <ActionForm action={saveVisitAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="id" value={visit?.id ?? ''} />
            <div className="form-grid">
              {visit ? (
                <>
                  <input type="hidden" name="residentId" value={visit.residentId} />
                  <div className="fld span-all"><span className="lbl">{t('spitex.form.client')}</span><strong>{clients.find((c) => c.id === visit.residentId)?.label ?? '–'}</strong></div>
                </>
              ) : (
                <Combobox label={t('spitex.form.client')} name="residentId" required wrapClassName="span-all" placeholder={t('spitex.form.clientPh')} options={clients.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))} />
              )}
              {visit?.fromTemplate
                ? <><input type="hidden" name="date" value={visit.date} /><div className="fld"><span className="lbl">{t('spitex.form.date')}</span><span className="small fg2">{t('spitex.form.templateDay')}</span></div></>
                : <DateField label={t('spitex.form.date')} name="date" defaultValue={visit?.date ?? day} min={today} max={maxDay} required />}
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-end' }}>
                <TimeField label={t('spitex.form.start')} name="start" defaultValue={visit?.start} step={300} quick={false} required wrapStyle={{ flex: 1, minWidth: 0 }} />
                <TimeField label={t('spitex.form.end')} name="end" defaultValue={visit?.end} step={300} quick={false} required wrapStyle={{ flex: 1, minWidth: 0 }} />
              </div>
              <Select label={t('spitex.form.assignee')} name="assigneeId" defaultValue={visit?.assigneeId ?? assigneeId ?? ''}>
                <option value="">{t('spitex.unassigned')}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
              <ServiceRows initial={visit?.services} />
              <Textarea label={t('spitex.form.note')} optional name="note" rows={2} maxLength={500} defaultValue={visit?.note ?? ''} wrapClassName="span-all" />
            </div>
            <Actions onClose={close} label={t('spitex.form.save')}
              extra={visit && <ActButton className="btn danger" action={() => cancelVisitAction(visit.id).then((r) => { if (r.ok) close(); return r })} confirm="spitex.confirm.cancel">{t('spitex.actions.cancelVisit')}</ActButton>} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Zuweisung direkt im Tagesplan. */
export function AssignSelect({ visitId, value, staff, name }: { visitId: string; value: string | null; staff: Opt[]; name: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [v, setV] = useState(value ?? '')
  return (
    <Select aria-label={t('spitex.actions.assignNamed', { name })} value={v} loading={pending} className="sx-assign"
      onChange={(e) => {
        const next = e.value
        const prev = v
        setV(next)
        start(async () => {
          const r = await assignVisitAction(visitId, next)
          if (!r.ok) { setV(prev); toast(t(r.error), { kind: 'crit' }) } else if (r.message) toast(r.message)
        })
      }}>
      <option value="">{t('spitex.unassigned')}</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </Select>
  )
}

/** Reihenfolge in der Tour: früher / später. */
export function MoveButtons({ visitId, first, last, name }: { visitId: string; first: boolean; last: boolean; name: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const move = (dir: -1 | 1) => start(async () => {
    const r = await moveVisitAction(visitId, dir)
    if (!r.ok) toast(t(r.error), { kind: 'crit' })
  })
  return (
    <span className="sx-move" aria-busy={pending || undefined}>
      <Tooltip content={t('spitex.actions.up')}>
        <button type="button" className="icon-btn" disabled={first || pending} aria-label={t('spitex.actions.upNamed', { name })} onClick={() => move(-1)}>
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5-5 5 5" /></svg>
        </button>
      </Tooltip>
      <Tooltip content={t('spitex.actions.down')}>
        <button type="button" className="icon-btn" disabled={last || pending} aria-label={t('spitex.actions.downNamed', { name })} onClick={() => move(1)}>
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 5 5 5-5" /></svg>
        </button>
      </Tooltip>
    </span>
  )
}
