'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { splitQuestion } from '@/components/ui/ConfirmDialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { saveOrderAction, stopOrderAction } from '@/app/(app)/residents/[id]/meds/actions'
import { ResidentContext } from './shared'
import type { ResidentCtxDto } from './types'
import { DateField } from '@/components/ui/DateField'

export type OrderDto = {
  id: string
  name: string
  form: string | null
  route: string
  indication: string | null
  kind: 'regular' | 'prn' | 'temporary'
  times: string[]
  doses: string[]
  prnDose: string | null
  prnMaxPerDay: number | null
  prnMinIntervalH: number | null
  start: string
  startKey: string
  end: string | null
  endKey: string
  prescriber: string | null
  requiresDoubleCheck: boolean
  stock: number | null
  stockUnit: string | null
  stockDays: number | null
  low: boolean
  notes: string | null
  active: boolean
  stopped: string | null
  createdBy: string
}

const ROUTES = ['p.o.', 's.l.', 's.c.', 'i.m.', 'i.v.', 'rektal', 'transdermal', 'inhalativ', 'topisch', 'nasal', 'okulär']

export function Orders({ orders, canEdit, resident, defaultSlots, defaultPrescriber, todayKey }: {
  orders: OrderDto[]
  canEdit: boolean
  resident: ResidentCtxDto
  defaultSlots: string[]
  defaultPrescriber: string | null
  todayKey: string
}) {
  const t = useT()
  const [edit, setEdit] = useState<OrderDto | 'new' | null>(null)
  const [stop, setStop] = useState<OrderDto | null>(null)
  const [showStopped, setShowStopped] = useState(false)
  const stoppedN = orders.filter((o) => !o.active).length
  const list = orders.filter((o) => o.active || showStopped)
  return (
    <>
      <div className="sec-head">
        <h2 className="sec" id="orders">{t('meds.orders.title')}</h2>
        <div className="row">
          {stoppedN > 0 && (
            <label className="check small fg2"><input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} />{t('meds.orders.showStopped', { n: stoppedN })}</label>
          )}
          {canEdit && <button type="button" className="btn sm" onClick={() => setEdit('new')}>{t('meds.orders.new')}</button>}
        </div>
      </div>
      {list.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead>
              <tr>
                <th>{t('meds.orders.drug')}</th>
                <th>{t('meds.orders.kind')}</th>
                <th>{t('meds.orders.dosage')}</th>
                <th>{t('meds.orders.period')}</th>
                <th>{t('meds.orders.prescriber')}</th>
                <th>{t('meds.orders.stock')}</th>
                {canEdit && <th className="right"><span className="sr-only">{t('meds.orders.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} style={o.active ? undefined : { color: 'var(--fg-3)' }}>
                  <td>
                    <div className={'drug' + (o.active ? '' : ' stopped')}>{o.name}</div>
                    <div className="drug-sub">{[o.form, o.route, o.indication].filter(Boolean).join(' · ')}</div>
                    {o.notes && <div className="small fg2">{o.notes}</div>}
                    <div className="row" style={{ gap: 4, marginTop: 3 }}>
                      {o.requiresDoubleCheck && <span className="tag violet">{t('meds.fourEyes.tag')}</span>}
                      {!o.active && <span className="tag outline">{t('meds.orders.stoppedOn', { at: o.stopped ?? '' })}</span>}
                    </div>
                  </td>
                  <td><span className={'tag ' + (o.kind === 'prn' ? 'accent' : o.kind === 'temporary' ? 'warn' : '')}>{t('meds.kind.' + o.kind)}</span></td>
                  <td className="small">
                    {o.kind === 'prn' ? (
                      <>
                        <div className="mono">{o.prnDose}</div>
                        <div className="muted">{[o.prnMaxPerDay != null && t('meds.orders.maxPerDay', { n: o.prnMaxPerDay }), o.prnMinIntervalH ? t('meds.prn.interval', { h: o.prnMinIntervalH }) : null].filter(Boolean).join(' · ')}</div>
                      </>
                    ) : (
                      <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {o.times.map((tm, i) => o.doses[i] && o.doses[i] !== '0' && <span key={tm} className="nowrap">{tm} <b style={{ fontWeight: 500 }}>{o.doses[i]}</b></span>)}
                      </div>
                    )}
                  </td>
                  <td className="small nowrap">{o.start}{o.end ? ' – ' + o.end : ''}</td>
                  <td className="small">{o.prescriber ?? '–'}<div className="muted">{t('meds.orders.enteredBy', { by: o.createdBy })}</div></td>
                  <td className="small nowrap">
                    {o.stock != null ? <span className="mono">{o.stock} {o.stockUnit ?? ''}</span> : '–'}
                    {o.stockDays != null && <div className={o.low ? 'warn-text' : 'muted'}>{t('meds.stock.days', { n: o.stockDays })}</div>}
                    {o.low && o.active && <div><span className="tag warn">{t('meds.stock.low')}</span></div>}
                  </td>
                  {canEdit && (
                    <td className="right nowrap">
                      {o.active && (
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button type="button" className="btn sm" onClick={() => setEdit(o)}>{t('common.edit')}</button>
                          <button type="button" className="btn sm danger" onClick={() => setStop(o)}>{t('meds.orders.stop')}</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>{t('meds.orders.none')}</p>
      )}
      {edit && (
        <OrderDialog
          order={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          resident={resident}
          defaultSlots={defaultSlots}
          defaultPrescriber={defaultPrescriber}
          todayKey={todayKey}
        />
      )}
      {stop && (
        <Dialog open onClose={() => setStop(null)} title={t('meds.orders.stopTitle')} context={<ResidentContext r={resident} />}>
          <ActionForm action={stopOrderAction} onDone={(r) => r.ok && setStop(null)} confirm={{ ...splitQuestion(t('meds.orders.stopConfirm', { drug: stop.name })), context: <><ResidentContext r={resident} /><span>{stop.name}</span></>, danger: true }}>
            <input type="hidden" name="id" value={stop.id} />
            <p style={{ margin: 0 }}><strong>{stop.name}</strong> <span className="small muted">{[stop.form, stop.route].filter(Boolean).join(' · ')}</span></p>
            <p className="small fg2" style={{ margin: 0 }}>{t('meds.orders.stopHint')}</p>
            <label className="fld">
              <span className="lbl">{t('meds.orders.stopReason')}</span>
              <input className="field" name="reason" required placeholder={t('meds.orders.stopReasonPh')} />
            </label>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setStop(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn danger solid">{t('meds.orders.stop')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

function OrderDialog({ order, onClose, resident, defaultSlots, defaultPrescriber, todayKey }: {
  order: OrderDto | null
  onClose: () => void
  resident: ResidentCtxDto
  defaultSlots: string[]
  defaultPrescriber: string | null
  todayKey: string
}) {
  const t = useT()
  const [kind, setKind] = useState<OrderDto['kind']>(order?.kind ?? 'regular')
  const own = order && order.kind !== 'prn' ? order.times : []
  const base = [...new Set([...defaultSlots, ...own])].sort().map((tm) => {
    const i = own.indexOf(tm)
    const d = i >= 0 && order ? order.doses[i] : ''
    return [tm, d === '0' ? '' : d] as const
  })
  const rows = [...base, ...Array.from({ length: Math.max(0, 6 - base.length) }, () => ['', ''] as const)].slice(0, 6)
  return (
    <Dialog open onClose={onClose} title={t(order ? 'meds.orders.editTitle' : 'meds.orders.newTitle')} context={<ResidentContext r={resident} />} wide>
      <ActionForm action={saveOrderAction} onDone={(r) => r.ok && onClose()}>
        <input type="hidden" name="residentId" value={resident.id} />
        {order && <input type="hidden" name="id" value={order.id} />}
        {order && <div className="alert info"><span className="grow">{t('meds.orders.editHint')}</span></div>}
        <div className="seg" role="group" aria-label={t('meds.orders.kind')} style={{ alignSelf: 'flex-start' }}>
          {(['regular', 'temporary', 'prn'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t('meds.kind.' + k)}</button>
          ))}
        </div>
        <input type="hidden" name="kind" value={kind} />
        <div className="form-grid">
          <label className="fld span-all">
            <span className="lbl">{t('meds.orders.name')}</span>
            <input className="field" name="name" required defaultValue={order?.name} placeholder={t('meds.orders.namePh')} />
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.form')}</span>
            <input className="field" name="form" defaultValue={order?.form ?? ''} placeholder={t('meds.orders.formPh')} />
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.route')}</span>
            <input className="field" name="route" list="routes" defaultValue={order?.route ?? 'p.o.'} />
            <datalist id="routes">{ROUTES.map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.indication')}</span>
            <input className="field" name="indication" defaultValue={order?.indication ?? ''} />
          </label>
        </div>
        {kind !== 'prn' ? (
          <fieldset>
            <legend className="lbl">{t('meds.orders.schedule')}</legend>
            <p className="small muted" style={{ margin: '0 0 8px' }}>{t('meds.orders.scheduleHint')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {rows.map(([tm, ds], i) => (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input className="field mono" name={'time_' + i} defaultValue={tm} placeholder="HH:MM" inputMode="numeric" aria-label={t('meds.orders.time', { n: i + 1 })} style={{ width: 76 }} />
                  <input className="field mono" name={'dose_' + i} defaultValue={ds} placeholder="0" aria-label={t('meds.orders.dose', { n: i + 1 })} />
                </div>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="form-grid">
            <label className="fld">
              <span className="lbl">{t('meds.orders.prnDose')}</span>
              <input className="field mono" name="prnDose" defaultValue={order?.prnDose ?? ''} required placeholder={t('meds.orders.prnDosePh')} />
            </label>
            <label className="fld">
              <span className="lbl">{t('meds.orders.prnMax')}</span>
              <input className="field mono" name="prnMaxPerDay" inputMode="numeric" defaultValue={order?.prnMaxPerDay ?? ''} required />
            </label>
            <label className="fld">
              <span className="lbl">{t('meds.orders.prnInterval')}</span>
              <input className="field mono" name="prnMinIntervalH" inputMode="numeric" defaultValue={order?.prnMinIntervalH ?? 4} />
            </label>
          </div>
        )}
        <div className="form-grid">
          <label className="fld">
            <span className="lbl">{t('meds.orders.start')}</span>
            <DateField name="startDate" defaultValue={todayKey} min={order ? todayKey : undefined} />
            {order && <span className="hint">{t('meds.orders.startEditHint')}</span>}
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.end')}{kind !== 'temporary' && <span style={{ textTransform: 'none', letterSpacing: 0 }}> ({t('common.optional')})</span>}</span>
            <DateField name="endDate" defaultValue={order?.endKey ?? ''} required={kind === 'temporary'} />
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.prescriber')}</span>
            <input className="field" name="prescriber" defaultValue={order?.prescriber ?? defaultPrescriber ?? ''} />
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.orders.stock')}</span>
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <input className="field mono" name="stock" inputMode="numeric" defaultValue={order?.stock ?? ''} style={{ width: 90 }} />
              <input className="field" name="stockUnit" defaultValue={order?.stockUnit ?? t('meds.orders.stockUnitDefault')} aria-label={t('meds.orders.stockUnit')} />
            </div>
          </label>
          <label className="fld span-all">
            <span className="lbl">{t('meds.orders.notes')}</span>
            <input className="field" name="notes" defaultValue={order?.notes ?? ''} placeholder={t('meds.orders.notesPh')} />
          </label>
        </div>
        <label className="check"><input type="checkbox" name="requiresDoubleCheck" defaultChecked={order?.requiresDoubleCheck} />{t('meds.orders.doubleCheck')}</label>
        {order && (
          <label className="fld">
            <span className="lbl">{t('meds.orders.changeReason')}</span>
            <input className="field" name="changeReason" required placeholder={t('meds.orders.changeReasonPh')} />
          </label>
        )}
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn primary">{t(order ? 'meds.orders.saveChange' : 'meds.orders.save')}</button>
        </div>
      </ActionForm>
    </Dialog>
  )
}
