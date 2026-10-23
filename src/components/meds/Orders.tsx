'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { toast } from '@/components/toast'
import { confirmOrderAction, previewInteractionsAction, saveOrderAction, stopOrderAction } from '@/app/(app)/residents/[id]/meds/actions'
import type { ActionResult } from '@/lib/action'
import type { GateDto } from '@/lib/medication-orders'
import { ResidentContext } from './shared'
import type { ResidentCtxDto } from './types'
import { blocking, checkAllergies, type AllergyMatch } from '@/lib/allergy-check'
import { Checkbox, Combobox, DateField, NumberField, SegmentedControl, TextField, TimeField } from '@/components/ui/fields'

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
  atc: string | null
  gtin: string | null
  /** Herkunft: ärztlich erfasst oder telefonisch/mündlich angeordnet */
  source: 'written' | 'phone' | 'verbal'
  confirm: 'none' | 'pending' | 'overdue' | 'confirmed'
  confirmDue: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  /** Diese Person darf jetzt gegenzeichnen */
  mineToConfirm: boolean
}

export type PhysicianOptionDto = { id: string; name: string; hint: string; external: boolean }

/** Server Actions der Verordnungen (Stationsapp oder Ärzteportal). */
export type OrderActions = {
  save: (form: FormData) => Promise<ActionResult>
  stop: (form: FormData) => Promise<ActionResult>
  confirm: (medicationId: string) => Promise<ActionResult>
  preview: (residentId: string, draft: { name: string; atc: string; gtin: string; replacesId: string | null }) => Promise<ActionResult<GateDto>>
}
const STATION: OrderActions = { save: saveOrderAction, stop: stopOrderAction, confirm: confirmOrderAction, preview: previewInteractionsAction }

const ROUTES = ['p.o.', 's.l.', 's.c.', 'i.m.', 'i.v.', 'rektal', 'transdermal', 'inhalativ', 'topisch', 'nasal', 'okulär']

export function Orders({ orders, canEdit, canPhone = false, physicians = [], phoneHours = 24, actions = STATION, resident, defaultSlots, defaultPrescriber, todayKey, interactionNote }: {
  orders: OrderDto[]
  canEdit: boolean
  /** Telefonische/mündliche Anordnung entgegennehmen (Pflege) */
  canPhone?: boolean
  physicians?: PhysicianOptionDto[]
  phoneHours?: number
  actions?: OrderActions
  resident: ResidentCtxDto
  defaultSlots: string[]
  defaultPrescriber: string | null
  todayKey: string
  /** Stand der Interaktionsprüfung (z. B. «keine Datenquelle angebunden – nicht geprüft») */
  interactionNote?: string
}) {
  const t = useT()
  const [edit, setEdit] = useState<OrderDto | 'new' | null>(null)
  const [stop, setStop] = useState<OrderDto | null>(null)
  const [showStopped, setShowStopped] = useState(false)
  const stoppedN = orders.filter((o) => !o.active).length
  const list = orders.filter((o) => o.active || showStopped)
  const pending = orders.filter((o) => o.confirm === 'pending' || o.confirm === 'overdue')
  const canChange = canEdit || canPhone
  const showActions = canChange || orders.some((o) => o.mineToConfirm)
  return (
    <>
      <div className="sec-head">
        <h2 className="sec" id="orders">{t('meds.orders.title')}</h2>
        <div className="row">
          {stoppedN > 0 && (
            <Checkbox checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} label={t('meds.orders.showStopped', { n: stoppedN })} wrapClassName="small fg2" />
          )}
          {canChange && <button type="button" className="btn sm" onClick={() => setEdit('new')}>{t(canEdit ? 'meds.orders.new' : 'meds.phone.newPhone')}</button>}
        </div>
      </div>
      {pending.length > 0 && (
        <div className={'alert ' + (pending.some((o) => o.confirm === 'overdue') ? 'crit' : 'warn')} role="status">
          <div className="grow stack-sm" style={{ gap: 4 }}>
            <strong>{t('meds.phone.pendingTitle')}</strong>
            <span>{t('meds.phone.pendingList', { n: pending.length })}</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {pending.map((o) => <li key={o.id}>{o.name} · {t(o.confirm === 'overdue' ? 'meds.phone.tagOverdue' : 'meds.phone.tagPending', { source: t('meds.phone.source.' + o.source), due: o.confirmDue ?? '' })}{o.prescriber ? ` · ${o.prescriber}` : ''}</li>)}
            </ul>
          </div>
        </div>
      )}
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
                {showActions && <th className="right"><span className="sr-only">{t('meds.orders.actions')}</span></th>}
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
                      {o.active && <AllergyTags hits={checkAllergies(resident.allergies, [o.name, o.form].filter(Boolean).join(' '))} />}
                      {o.requiresDoubleCheck && <span className="tag violet">{t('meds.fourEyes.tag')}</span>}
                      {!o.active && <span className="tag outline">{t('meds.orders.stoppedOn', { at: o.stopped ?? '' })}</span>}
                      {(o.confirm === 'pending' || o.confirm === 'overdue') && (
                        <span className={'tag ' + (o.confirm === 'overdue' ? 'crit' : 'warn')}>{t(o.confirm === 'overdue' ? 'meds.phone.tagOverdue' : 'meds.phone.tagPending', { source: t('meds.phone.source.' + o.source), due: o.confirmDue ?? '' })}</span>
                      )}
                    </div>
                    {o.confirm === 'confirmed' && <div className="small muted">{t('meds.phone.source.' + o.source)} · {t('meds.phone.confirmedBy', { by: o.confirmedBy ?? '–', at: o.confirmedAt ?? '' })}</div>}
                    {(o.atc || o.gtin) && <div className="small muted mono">{[o.atc && `ATC ${o.atc}`, o.gtin && `GTIN ${o.gtin}`].filter(Boolean).join(' · ')}</div>}
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
                  {showActions && (
                    <td className="right nowrap">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        {o.mineToConfirm && <ConfirmButton order={o} resident={resident} action={actions.confirm} />}
                        {o.active && canChange && <button type="button" className="btn sm" onClick={() => setEdit(o)}>{t('common.edit')}</button>}
                        {o.active && canEdit && <button type="button" className="btn sm danger" onClick={() => setStop(o)}>{t('meds.orders.stop')}</button>}
                      </div>
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
          interactionNote={interactionNote}
          phoneMode={!canEdit && canPhone}
          physicians={physicians}
          phoneHours={phoneHours}
          actions={actions}
        />
      )}
      {stop && (
        <Dialog open onClose={() => setStop(null)} title={t('meds.orders.stopTitle')} context={<ResidentContext r={resident} />}>
          <ActionForm action={actions.stop} onDone={(r) => r.ok && setStop(null)} confirm={{ ...splitQuestion(t('meds.orders.stopConfirm', { drug: stop.name })), context: <><ResidentContext r={resident} /><span>{stop.name}</span></>, danger: true }}>
            <input type="hidden" name="id" value={stop.id} />
            <input type="hidden" name="residentId" value={resident.id} />
            <p style={{ margin: 0 }}><strong>{stop.name}</strong> <span className="small muted">{[stop.form, stop.route].filter(Boolean).join(' · ')}</span></p>
            <p className="small fg2" style={{ margin: 0 }}>{t('meds.orders.stopHint')}</p>
            <TextField label={t('meds.orders.stopReason')} name="reason" required placeholder={t('meds.orders.stopReasonPh')} />
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

/** Gegenzeichnen (Visum) mit Bestätigung und Patientenkontext; nur Pending-Zustand, nicht optimistisch (PRD §32). */
function ConfirmButton({ order, resident, action }: { order: OrderDto; resident: ResidentCtxDto; action: OrderActions['confirm'] }) {
  const t = useT()
  const [ask, dialog] = useConfirm()
  const [pending, start] = useTransition()
  const go = async () => {
    if (!(await ask({ ...splitQuestion(t('meds.phone.confirmQ', { drug: order.name })), context: <><ResidentContext r={resident} /><span>{order.name}</span></>, confirmLabel: t('meds.phone.confirm') }))) return
    start(async () => {
      const r = await action(order.id)
      toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' })
    })
  }
  return <><button type="button" className="btn sm primary" onClick={() => void go()} disabled={pending} data-loading={pending || undefined}>{t('meds.phone.confirm')}</button>{dialog}</>
}

/** Interaktionsprüfung live im Dialog (vor dem Speichern); ohne Datenquelle ausdrücklich «nicht geprüft». */
function useInteractionPreview(residentId: string, replacesId: string | null, draft: { name: string; atc: string; gtin: string }, action: OrderActions['preview']) {
  const [res, setRes] = useState<GateDto | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (draft.name.trim().length < 2) { setRes(null); return }
    const n = ++seq.current
    const h = window.setTimeout(async () => {
      setBusy(true)
      const r = await action(residentId, { ...draft, replacesId })
      if (n !== seq.current) return
      setBusy(false)
      setRes(r.ok ? r.data ?? null : null)
    }, 500)
    return () => window.clearTimeout(h)
  }, [residentId, replacesId, draft, action])
  return { res, busy }
}

function InteractionPanel({ res, busy, fallback }: { res: GateDto | null; busy: boolean; fallback?: string }) {
  const t = useT()
  const label = <span className="lbl">{t('meds.interactions.title')}</span>
  if (busy && !res) return <p className="small muted" style={{ margin: 0 }} aria-live="polite">{label} {t('meds.ia.checking')}</p>
  if (!res || res.level === 'unavailable') {
    const text = res ? t(res.reason === 'no_adapter' ? 'meds.interactions.noAdapter' : res.reason === 'error' ? 'meds.interactions.error' : 'meds.interactions.orderNote', { name: res.source ?? '' }) : fallback
    return text ? <p className="small muted" style={{ margin: 0 }} aria-live="polite">{label} <span className="tag warn">{t('meds.interactions.notChecked')}</span> {text}</p> : null
  }
  if (res.level === 'clear') return <p className="small muted" style={{ margin: 0 }} aria-live="polite">{label} <span className="tag ok">{t('meds.interactions.checked')}</span> {t('meds.ia.clear', { name: res.source ?? '' })}</p>
  const hard = res.level === 'contraindicated' || res.level === 'major'
  return (
    <div className={'alert ' + (hard ? 'crit' : 'warn')} role="alert" id="ord-ia">
      <div className="grow stack-sm" style={{ gap: 6 }}>
        <strong>{t('meds.ia.found', { name: res.source ?? '' })}</strong>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {res.hits.map((h, i) => <li key={i}><span className="tag">{t('meds.interactions.severity.' + h.severity)}</span> <strong>{h.drugs}</strong> · {h.text}</li>)}
        </ul>
        {res.needsReason && <TextField label={t('meds.ia.reason')} name="interactionReason" required maxLength={500} hint={t('meds.ia.reasonHint')} />}
      </div>
    </div>
  )
}

function OrderDialog({ order, onClose, resident, defaultSlots, defaultPrescriber, todayKey, interactionNote, phoneMode, physicians, phoneHours, actions }: {
  order: OrderDto | null
  onClose: () => void
  resident: ResidentCtxDto
  defaultSlots: string[]
  defaultPrescriber: string | null
  todayKey: string
  interactionNote?: string
  /** Pflege ohne Verordnungsrecht: nur telefonische/mündliche Anordnung */
  phoneMode: boolean
  physicians: PhysicianOptionDto[]
  phoneHours: number
  actions: OrderActions
}) {
  const t = useT()
  const [kind, setKind] = useState<OrderDto['kind']>(order?.kind ?? 'regular')
  const [codes, setCodes] = useState({ atc: order?.atc ?? '', gtin: order?.gtin ?? '' })
  // Allergie-Abgleich live beim Erfassen (PRD §13.1); der Server prüft beim Speichern erneut
  const [drug, setDrug] = useState({ name: order?.name ?? '', form: order?.form ?? '' })
  const hits = useMemo(() => checkAllergies(resident.allergies, [drug.name, drug.form].join(' ')), [resident.allergies, drug])
  const draft = useMemo(() => ({ name: drug.name, atc: codes.atc, gtin: codes.gtin }), [drug.name, codes])
  const ia = useInteractionPreview(resident.id, order?.id ?? null, draft, actions.preview)
  const own = order && order.kind !== 'prn' ? order.times : []
  const base = [...new Set([...defaultSlots, ...own])].sort().map((tm) => {
    const i = own.indexOf(tm)
    const d = i >= 0 && order ? order.doses[i] : ''
    return [tm, d === '0' ? '' : d] as const
  })
  const rows = [...base, ...Array.from({ length: Math.max(0, 6 - base.length) }, () => ['', ''] as const)].slice(0, 6)
  return (
    <Dialog open onClose={onClose} title={t(phoneMode ? (order ? 'meds.phone.editPhoneTitle' : 'meds.phone.newPhoneTitle') : order ? 'meds.orders.editTitle' : 'meds.orders.newTitle')} context={<ResidentContext r={resident} />} wide>
      <ActionForm action={actions.save} onDone={(r) => r.ok && onClose()}>
        <input type="hidden" name="residentId" value={resident.id} />
        {order && <input type="hidden" name="id" value={order.id} />}
        {order && <div className="alert info"><span className="grow">{t('meds.orders.editHint')}</span></div>}
        {phoneMode && (
          <div className="stack-sm">
            <div className="alert warn"><span className="grow">{t('meds.phone.info', { h: phoneHours })}</span></div>
            <div className="form-grid">
              <div className="stack-sm" style={{ gap: 6 }}>
                <span className="lbl" aria-hidden="true">{t('meds.phone.sourceLabel')}</span>
                <SegmentedControl name="orderSource" aria-label={t('meds.phone.sourceLabel')} defaultValue="phone"
                  options={(['phone', 'verbal'] as const).map((k) => ({ value: k, label: t('meds.phone.source.' + k) }))} />
              </div>
              <Combobox label={t('meds.phone.orderedBy')} hint={t('meds.phone.orderedByHint')} name="orderedBy" required freeText maxLength={120}
                options={physicians.map((p) => ({ value: p.id, label: p.name, hint: [p.hint, p.external ? t('meds.phone.external') : ''].filter(Boolean).join(' · ') }))} />
            </div>
          </div>
        )}
        <SegmentedControl name="kind" aria-label={t('meds.orders.kind')} value={kind} onChange={(v) => setKind(v as typeof kind)}
          options={(['regular', 'temporary', 'prn'] as const).map((k) => ({ value: k, label: t('meds.kind.' + k) }))} />
        <div className="form-grid">
          <TextField label={t('meds.orders.name')} wrapClassName="span-all" name="name" required defaultValue={order?.name} placeholder={t('meds.orders.namePh')}
            onChange={(e) => setDrug((d) => ({ ...d, name: e.target.value }))} aria-describedby={hits.length ? 'ord-allergy' : undefined} />
          <TextField label={t('meds.orders.form')} name="form" defaultValue={order?.form ?? ''} placeholder={t('meds.orders.formPh')}
            onChange={(e) => setDrug((d) => ({ ...d, form: e.target.value }))} />
          <Combobox label={t('meds.orders.route')} name="route" defaultValue={order?.route ?? 'p.o.'} freeText maxLength={40} options={ROUTES.map((r) => ({ value: r, label: r }))} />
          <TextField label={t('meds.orders.indication')} name="indication" defaultValue={order?.indication ?? ''} />
          <TextField label={t('meds.codes.atc')} optional name="atc" defaultValue={order?.atc ?? ''} placeholder={t('meds.codes.atcHint')} maxLength={7} className="mono" autoComplete="off"
            onChange={(e) => setCodes((c) => ({ ...c, atc: e.target.value }))} />
          <TextField label={t('meds.codes.gtin')} optional name="gtin" defaultValue={order?.gtin ?? ''} placeholder={t('meds.codes.gtinHint')} maxLength={14} inputMode="numeric" className="mono" autoComplete="off"
            onChange={(e) => setCodes((c) => ({ ...c, gtin: e.target.value }))} />
        </div>
        {kind !== 'prn' ? (
          <fieldset>
            <legend className="lbl">{t('meds.orders.schedule')}</legend>
            <p className="small muted" style={{ margin: '0 0 8px' }}>{t('meds.orders.scheduleHint')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 13rem), 1fr))', gap: 10 }}>
              {rows.map(([tm, ds], i) => (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <TimeField name={'time_' + i} defaultValue={tm} aria-label={t('meds.orders.time', { n: i + 1 })} style={{ width: '7.5rem', flex: 'none' }} />
                  <TextField name={'dose_' + i} defaultValue={ds} placeholder="0" aria-label={t('meds.orders.dose', { n: i + 1 })} className="mono" />
                </div>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="form-grid">
            <TextField label={t('meds.orders.prnDose')} name="prnDose" defaultValue={order?.prnDose ?? ''} required placeholder={t('meds.orders.prnDosePh')} className="mono" />
            <NumberField label={t('meds.orders.prnMax')} name="prnMaxPerDay" min={1} max={24} step={1} defaultValue={order?.prnMaxPerDay ?? ''} required />
            <NumberField label={t('meds.orders.prnInterval')} name="prnMinIntervalH" min={0} max={72} step={1} defaultValue={order?.prnMinIntervalH ?? 4} />
          </div>
        )}
        <div className="form-grid">
          <DateField label={t('meds.orders.start')} hint={order ? t('meds.orders.startEditHint') : undefined} name="startDate" defaultValue={todayKey} min={order ? todayKey : undefined} />
          <DateField label={t('meds.orders.end')} optional={kind !== 'temporary'} name="endDate" defaultValue={order?.endKey ?? ''} required={kind === 'temporary'} />
          {!phoneMode && <TextField label={t('meds.orders.prescriber')} name="prescriber" defaultValue={order?.prescriber ?? defaultPrescriber ?? ''} />}
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-end' }}>
            <NumberField label={t('meds.orders.stock')} optional name="stock" min={0} step={1} defaultValue={order?.stock ?? ''} wrapStyle={{ width: '7rem', flex: 'none' }} />
            <TextField label={t('meds.orders.stockUnit')} hideLabel name="stockUnit" defaultValue={order?.stockUnit ?? t('meds.orders.stockUnitDefault')} wrapClassName="grow" />
          </div>
          <TextField label={t('meds.orders.notes')} wrapClassName="span-all" name="notes" defaultValue={order?.notes ?? ''} placeholder={t('meds.orders.notesPh')} />
        </div>
        <Checkbox name="requiresDoubleCheck" defaultChecked={order?.requiresDoubleCheck} label={t('meds.orders.doubleCheck')} />
        <AllergyPanel hits={hits} />
        <InteractionPanel res={ia.res} busy={ia.busy} fallback={interactionNote} />
        {order && (
          <TextField label={t('meds.orders.changeReason')} name="changeReason" required placeholder={t('meds.orders.changeReasonPh')} />
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

/** Allergie-Treffer einer Verordnung als Tag (Liste, Abgabe, Medikamentenrunde). */
export function AllergyTags({ hits }: { hits: AllergyMatch[] }) {
  const t = useT()
  if (!hits.length) return null
  return (
    <>
      {hits.map((h) => (
        <span key={h.allergy} className={'tag ' + (h.kind === 'cross' ? 'warn' : 'crit')} title={allergyText(t, h)}>
          {t(h.kind === 'cross' ? 'meds.allergy.tagCross' : 'meds.allergy.tag', { allergy: h.allergy })}
        </span>
      ))}
    </>
  )
}

export function allergyText(t: (k: string, v?: Record<string, string>) => string, h: AllergyMatch) {
  const cls = h.classKey ? t('meds.allergy.classes.' + h.classKey) : ''
  return t('meds.allergy.' + h.kind, { allergy: h.allergy, term: h.term, class: cls })
}

/** Warnung im Verordnungsdialog: Treffer mit Begründungspflicht (direkt/Klasse) oder Hinweis (Kreuzreaktion). */
function AllergyPanel({ hits }: { hits: AllergyMatch[] }) {
  const t = useT()
  if (!hits.length) return null
  const hard = blocking(hits)
  return (
    <div className={'alert ' + (hard ? 'crit' : 'warn')} id="ord-allergy" role="alert">
      <div className="grow stack-sm" style={{ gap: 6 }}>
        <strong>{t(hard ? 'meds.allergy.title' : 'meds.allergy.titleCross')}</strong>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {hits.map((h) => <li key={h.allergy}>{allergyText(t, h)}</li>)}
        </ul>
        {hard && (
          <TextField label={t('meds.allergy.reason')} name="allergyReason" required maxLength={500} placeholder={t('meds.allergy.reasonPh')} hint={t('meds.allergy.reasonHint')} />
        )}
        <span className="small">{t('meds.allergy.localNote')}</span>
      </div>
    </div>
  )
}
