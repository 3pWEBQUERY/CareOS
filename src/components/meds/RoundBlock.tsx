'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { DoseDialog, earlyConfirm, stateLabel, tooEarly } from './MarTable'
import { ResidentContext, useDoseCall } from './shared'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { doseText } from './dose'
import type { ColleagueDto, DoseStateDto, MarRowDto, ResidentCtxDto } from './types'

export type RoundResidentDto = {
  resident: ResidentCtxDto
  risks: string[]
  lines: MarRowDto[]
}
export type RoundNextDto = { id: string; label: string } | null

/** Zur nächsten Person springen: Block an den Anfang scrollen und die Überschrift fokussieren (Tastatur, Screenreader). */
export function goToResident(id: string) {
  const el = document.getElementById('rr-' + id)
  if (!el) return
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
  el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
}

/**
 * Ein Block pro Person in der Medikamentenrunde (PRD §13.2): Person, Zimmer, Allergien immer im Kopf;
 * pro Medikament Dosis mit Einheit, Applikationsweg, Zeit und besondere Hinweise; grosse Statusknöpfe.
 * Bei Seitenaufruf bereits vollständige Personen sind eingeklappt; während der Runde abgeschlossene bleiben stehen,
 * damit nichts unter dem Finger verrutscht.
 */
export function RoundBlock({ data, time, slotKey, day, editable, colleagues, next }: {
  data: RoundResidentDto
  time: string
  slotKey: string
  day: string
  editable: boolean
  colleagues: ColleagueDto[]
  next: RoundNextDto
}) {
  const t = useT()
  const { pending, record, isBusy } = useDoseCall(day)
  const [dlg, setDlg] = useState<{ row: MarRowDto; status?: DoseStateDto } | null>(null)
  const slots = [{ time, key: slotKey }]
  const cells = data.lines.map((l) => l.cells[0]!)
  const documented = cells.filter((c) => c.state !== 'open').length
  const complete = documented === cells.length
  const [collapsed, setCollapsed] = useState(complete)
  const r = data.resident
  const show = !complete || !collapsed

  const [ask, confirmDialog] = useConfirm()
  const act = async (row: MarRowDto, status: DoseStateDto) => {
    const c = row.cells[0]!
    if (pending) return
    if (status === 'given' && row.requiresDoubleCheck) return setDlg({ row, status })
    if (status === 'omitted' || status === 'held') return setDlg({ row, status })
    if (status === 'given' && tooEarly(day, time) && !(await ask(earlyConfirm(t, r, row, c.dose, time)))) return
    record(row, time, status, c.adminId)
  }

  return (
    <section className={'round-res' + (complete ? ' done' : '')} id={'rr-' + r.id} data-round-res="" aria-labelledby={'rrh-' + r.id}>
      <header>
        {r.room && <span className="room"><span className="sr-only">{t('meds.roomShort', { room: '' })}</span>{r.room}</span>}
        <h2 id={'rrh-' + r.id} tabIndex={-1}>{r.name}</h2>
        {r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>)}
        {data.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
        <span className="grow" />
        <span className={'tag ' + (complete ? 'ok' : 'outline')}>{complete ? '✓ ' + t('meds.round.complete') : t('meds.round.documented', { n: documented, total: cells.length })}</span>
        {complete && (
          <button type="button" className="btn sm ghost" aria-expanded={show} aria-controls={'rrb-' + r.id} onClick={() => setCollapsed(show)}>
            {t(show ? 'meds.round.collapse' : 'meds.round.expand', { n: cells.length })}
          </button>
        )}
      </header>
      {show && (
        <div id={'rrb-' + r.id}>
          {data.lines.map((row) => {
            const c = row.cells[0]!
            const busy = isBusy(row.id, time)
            return (
              <div key={row.id} className={'round-line' + (c.state !== 'open' ? ' is-documented' : c.over ? ' is-over' : '')}>
                <div className="rl-drug">
                  <div className="drug">{row.name}</div>
                  <div className="drug-sub">{[row.form, row.indication].filter(Boolean).join(' · ')}</div>
                  {row.notes && <div className="small warn-text rl-note"><span className="lbl warn-text">{t('meds.round.notes')}</span> {row.notes}</div>}
                  {row.requiresDoubleCheck && <span className="tag violet" style={{ marginTop: 3 }}>{t('meds.fourEyes.tag')}</span>}
                </div>
                <div className="rl-dose">
                  <span className="dosev">{doseText(c.dose, row.form) || '–'}</span>
                  <span className="small fg2"><span className="rl-route">{row.route}</span> · <span className="mono">{time}</span></span>
                </div>
                <div className="round-act">
                  {c.state === 'open' ? (
                    editable && (
                      <>
                        <button type="button" className="btn lg primary" disabled={pending} data-loading={busy || undefined} onClick={() => act(row, 'given')}>✓ {t('meds.action.given')}</button>
                        <button type="button" className="btn lg" disabled={pending} onClick={() => act(row, 'refused')}>✕ {t('meds.action.refused')}</button>
                        <button type="button" className="btn lg" disabled={pending} onClick={() => act(row, 'omitted')}>{t('meds.round.omitted')}</button>
                      </>
                    )
                  ) : (
                    <>
                      <span className={'tag ' + (c.state === 'given' ? 'ok' : 'warn')} style={{ fontSize: '0.75rem' }}>
                        {c.state === 'given' ? '✓ ' : '✕ '}{t('meds.state.' + c.state)}
                      </span>
                      <span className="small muted mono">{c.state === 'given' ? stateLabel(t, c) : [c.at, c.by].filter(Boolean).join(' ')}</span>
                      {editable && <button type="button" className="btn ghost" disabled={pending} onClick={() => setDlg({ row })}>{t('meds.round.reset')}</button>}
                    </>
                  )}
                </div>
                {c.state === 'open' && c.over && <div className="small crit-text rl-over">▲ {t('meds.round.overdue', { time })}</div>}
                {c.state !== 'open' && c.note && <div className="small fg2 rl-over">{c.note}</div>}
              </div>
            )
          })}
          {complete && next && (
            <div className="round-next">
              <button type="button" className="btn lg" onClick={() => goToResident(next.id)}>{t('meds.round.nextTo', { name: next.label })} ›</button>
            </div>
          )}
        </div>
      )}
      {dlg && (
        <DoseDialog
          row={dlg.row}
          slots={slots}
          initialTime={time}
          initialStatus={dlg.status}
          day={day}
          editable={editable}
          resident={r}
          colleagues={colleagues}
          onClose={() => setDlg(null)}
        />
      )}
      {confirmDialog}
    </section>
  )
}

/** Fortschritt der Runde mit Sprung zur nächsten offenen Person; bleibt beim Scrollen sichtbar. */
export function RoundProgress({ done, total, next }: { done: number; total: number; next: RoundNextDto }) {
  const t = useT()
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="round-bar">
      <div className="row-between">
        <strong aria-live="polite">{t('meds.round.progress', { n: done, total })}</strong>
        {next ? (
          <button type="button" className="btn primary" onClick={() => goToResident(next.id)}>{t('meds.round.nextOpen', { name: next.label })} ›</button>
        ) : (
          <span className="tag ok">✓ {t('meds.round.allDone')}</span>
        )}
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('meds.round.progress', { n: done, total })}><i className={done === total ? 'ok' : ''} style={{ width: pct + '%' }} /></div>
    </div>
  )
}
