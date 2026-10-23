'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Checkbox, NumberField, Textarea } from '@/components/ui/fields'
import { IconExternal } from '@/components/icons'
import type { TourSnapshot, VisitStepData } from '@/lib/offline/types'
import './spitex.css'

export type TourVisit = TourSnapshot['visits'][number] & { hasAccess?: boolean; recordHref?: string | null; doneFrom?: string | null; doneTo?: string | null }
export type StepOutcome = { ok: true; queued?: boolean; message?: string } | { ok: false; error: string }

const hmNow = () => new Date().toTimeString().slice(0, 5)

/**
 * Ein Einsatz in «Meine Tour» (online und in der Offline-Ansicht): Einsatzort mit Kartenlink, Telefon, Zugang
 * (nur online, protokolliert), Beginn, Leistungen mit Minuten, Notiz, Abschluss oder «nicht angetroffen».
 * `onStep` führt den Schritt aus oder legt ihn in die Outbox; die Karte zeigt den Stand sofort an.
 */
export function TourCard({ v, n, onStep, revealAccess, current }: {
  v: TourVisit
  n: number
  onStep: (d: VisitStepData) => Promise<StepOutcome>
  /** Zugang abrufen (Server, Audit); fehlt offline */
  revealAccess?: () => Promise<{ ok: true; data?: { text: string } } | { ok: false; error: string }>
  /** Nächster offener Einsatz der Tour (hervorgehoben, Details offen) */
  current?: boolean
}) {
  const t = useT()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const [pending, start] = useTransition()
  const [local, setLocal] = useState<{ status: string; startedAt: string | null; queued: boolean } | null>(null)
  const status = local?.status ?? v.status
  const startedAt = local?.startedAt ?? v.startedAt
  const [svc, setSvc] = useState(() => Object.fromEntries(v.services.map((s) => [s.id, { done: true, minutes: s.plannedMin as number | '' }])))
  const [note, setNote] = useState('')
  const [missed, setMissed] = useState(false)
  const [access, setAccess] = useState<string | null>(null)
  const [accessBusy, setAccessBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const closed = status === 'done' || status === 'missed' || status === 'cancelled'

  const step = (d: VisitStepData, next: string) => start(async () => {
    setErr(null)
    try {
      const r = await onStep(d)
      if (!r.ok) { setErr(tr(r.error)); return }
      setLocal({ status: next, startedAt: d.step === 'start' ? hmNow() : startedAt, queued: !!r.queued || !!local?.queued })
      if (r.message) toast(tr(r.message))
    } catch {
      setErr(t('common.genericError'))
    }
  })
  const finish = () => {
    const services = v.services.map((s) => ({ id: s.id, done: svc[s.id]?.done ?? false, minutes: typeof svc[s.id]?.minutes === 'number' ? (svc[s.id].minutes as number) : null }))
    if (services.some((s) => s.done && (s.minutes == null || s.minutes < 1))) { setErr(t('spitex.errors.minutes')); return }
    step({ visitId: v.id, step: 'finish', services, note: note.trim() || undefined }, 'done')
  }
  const miss = () => {
    if (note.trim().length < 3) { setErr(t('spitex.tour.missedReasonRequired')); return }
    step({ visitId: v.id, step: 'missed', note: note.trim() }, 'missed')
  }
  const showAccess = async () => {
    if (!revealAccess) return
    setAccessBusy(true)
    try {
      const r = await revealAccess()
      if (r.ok && r.data) setAccess(r.data.text)
      else if (!r.ok) toast(tr(r.error), { kind: 'crit' })
    } catch {
      toast(t('spitex.access.offline'), { kind: 'crit' })
    } finally {
      setAccessBusy(false)
    }
  }
  const total = v.services.reduce((s, x) => s + (svc[x.id]?.done && typeof svc[x.id].minutes === 'number' ? (svc[x.id].minutes as number) : 0), 0)

  return (
    <li className={'sx-stop' + (current ? ' is-current' : '') + (closed ? ' is-closed' : '')} aria-current={current ? 'step' : undefined}>
      <div className="sx-stop-head">
        <span className="sx-stop-n mono" aria-hidden="true">{n}</span>
        <div className="grow">
          <div className="sx-stop-time mono">{v.from}–{v.to}</div>
          <h2 className="sx-stop-name">
            {v.recordHref ? <a className="linkbtn" href={v.recordHref}>{v.name}</a> : v.name}
            <span className="sr-only"> · {t('spitex.tour.stop', { n })}</span>
          </h2>
        </div>
        <span className={'tag ' + (status === 'done' ? 'ok' : status === 'started' ? 'accent' : status === 'missed' ? 'crit' : 'outline')}>{t('spitex.status.' + status)}</span>
      </div>
      {v.allergies && v.allergies.length > 0 && <div className="flag crit sx-allergy">{t('spitex.tour.allergies')}: {v.allergies.join(', ')}</div>}
      <div className="sx-where">
        {v.address ? <span className="sx-address">{v.address}</span> : <span className="muted">{t('spitex.noAddress')}</span>}
        <div className="row sx-where-act">
          {v.mapsHref && <a className="btn sm" href={v.mapsHref} target="_blank" rel="noopener noreferrer">{t('spitex.tour.map')}<IconExternal size={14} /><span className="sr-only"> ({t('spitex.tour.newWindow')})</span></a>}
          {v.phone && <a className="btn sm" href={'tel:' + v.phone.replace(/[^+0-9]/g, '')}>{t('spitex.tour.call')} <span className="mono">{v.phone}</span></a>}
          {v.hasAccess && revealAccess && !access && !closed && (
            <button type="button" className="btn sm" onClick={showAccess} disabled={accessBusy} data-loading={accessBusy || undefined}>{t('spitex.access.show')}</button>
          )}
        </div>
        {v.hasAccess && !revealAccess && !closed && <p className="small muted" style={{ margin: 0 }}>{t('spitex.access.onlineOnly')}</p>}
        {access && (
          <div className="sx-access" role="note">
            <span className="lbl">{t('spitex.access.title')}</span>
            <p>{access}</p>
            <button type="button" className="btn sm ghost" onClick={() => setAccess(null)}>{t('spitex.access.hide')}</button>
          </div>
        )}
      </div>

      {status === 'planned' && !missed && (
        <div className="sx-stop-act">
          <button type="button" className="btn primary lg" onClick={() => step({ visitId: v.id, step: 'start' }, 'started')} disabled={pending} data-loading={pending || undefined}>{t('spitex.tour.start')}</button>
          <button type="button" className="btn ghost" onClick={() => { setMissed(true); setErr(null) }}>{t('spitex.tour.missed')}</button>
        </div>
      )}

      {(status === 'started' || (status === 'planned' && missed)) && (
        <div className="sx-doc stack-sm">
          {status === 'started' && (
            <>
              <p className="small fg2" style={{ margin: 0 }}>{t('spitex.tour.since', { time: startedAt ?? '–' })}</p>
              <fieldset className="sx-check">
                <legend className="lbl">{t('spitex.tour.services')}</legend>
                <ul className="sx-check-list">
                  {v.services.map((s) => (
                    <li key={s.id}>
                      <Checkbox label={<><span className="sx-klv-b">{s.klv}</span> {s.label}</>} checked={svc[s.id]?.done ?? false}
                        onChange={(e) => { const done = e.currentTarget.checked; setSvc((x) => ({ ...x, [s.id]: { ...x[s.id], done } })) }} />
                      <NumberField label={t('spitex.tour.minutesFor', { label: s.label })} hideLabel value={svc[s.id]?.minutes ?? ''} min={1} max={240} step={1} unit={t('spitex.min')}
                        disabled={!svc[s.id]?.done} wrapClassName="sx-check-min" onChange={(m) => setSvc((x) => ({ ...x, [s.id]: { ...x[s.id], minutes: m } }))} />
                    </li>
                  ))}
                </ul>
                <p className="small muted mono" style={{ margin: 0 }}>{t('spitex.minutes', { n: total })}</p>
              </fieldset>
            </>
          )}
          <Textarea label={t(missed && status === 'planned' ? 'spitex.tour.missedReason' : 'spitex.tour.note')} optional={!(missed && status === 'planned')} required={missed && status === 'planned'}
            rows={2} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); setErr(null) }} hint={missed && status === 'planned' ? undefined : t('spitex.tour.noteHint')} />
          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="sx-stop-act">
            {status === 'started'
              ? <button type="button" className="btn primary lg" onClick={finish} disabled={pending} data-loading={pending || undefined}>{t('spitex.tour.finish')}</button>
              : <>
                  <button type="button" className="btn danger lg" onClick={miss} disabled={pending} data-loading={pending || undefined}>{t('spitex.tour.missedSave')}</button>
                  <button type="button" className="btn ghost" onClick={() => { setMissed(false); setErr(null) }}>{t('common.cancel')}</button>
                </>}
          </div>
        </div>
      )}

      {err && status !== 'started' && !(status === 'planned' && missed) && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      {closed && status === 'done' && (v.doneFrom || local) && <p className="small ok-text" style={{ margin: 0 }}>{t('spitex.doneAt', { from: v.doneFrom ?? startedAt ?? '–', to: v.doneTo ?? hmNow() })}</p>}
      {local?.queued && <p className="small warn-text" style={{ margin: 0 }} role="status">{t('common.offlineSync.queued')}</p>}
    </li>
  )
}
