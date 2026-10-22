'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { setDoseAction } from '@/app/(app)/residents/[id]/meds/actions'
import { FourEyes, ResidentContext, useDoseCall } from './shared'
import { doseText } from './dose'
import type { CellDto, ColleagueDto, DoseStateDto, MarRowDto, ResidentCtxDto } from './types'

type Slot = { time: string; key: string }

/** Mehr als 60 Minuten vor dem geplanten Zeitpunkt (Rückfrage vor der Abgabe). */
export function tooEarly(day: string, time: string) {
  const [h, m] = time.split(':').map(Number)
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m).getTime() - Date.now() > 60 * 60_000
}

export function stateLabel(t: (k: string) => string, c: CellDto) {
  if (c.state === 'given') return [c.at, c.by && (c.checkedBy ? `${c.by}/${c.checkedBy}` : c.by)].filter(Boolean).join(' ')
  if (c.state === 'open') return c.over ? t('meds.state.overdue') : ''
  return t('meds.state.' + c.state)
}

/**
 * Abgabeliste (MAR) eines Tages: Tippen auf eine offene Dosis quittiert sie mit Ihrem Kürzel (Rückgängig im Toast).
 * Bereits dokumentierte Dosen öffnen die Korrektur – ein zweiter Tipp ändert nie stillschweigend den Status (PRD §32).
 */
export function MarTable({ rows, slots, day, editable, resident, colleagues }: {
  rows: MarRowDto[]
  slots: Slot[]
  day: string
  editable: boolean
  resident: ResidentCtxDto
  colleagues: ColleagueDto[]
}) {
  const t = useT()
  const { pending, record, isBusy } = useDoseCall(day)
  const [dlg, setDlg] = useState<{ row: MarRowDto; time: string; status?: DoseStateDto } | null>(null)

  const click = (row: MarRowDto, c: CellDto) => {
    if (!editable || pending) return
    if (c.state !== 'open' || !c.applicable) return setDlg({ row, time: c.time })
    if (row.requiresDoubleCheck) return setDlg({ row, time: c.time, status: 'given' })
    if (tooEarly(day, c.time) && !window.confirm(t('meds.confirmEarly', { time: c.time }))) return
    record(row, c.time, 'given', c.adminId)
  }

  return (
    <>
      <div className="tablewrap">
        <table className="mar">
          <thead>
            <tr>
              <th scope="col">{t('meds.mar.drug')}</th>
              {slots.map((s) => <th key={s.time} scope="col" className="slot">{t('meds.slots.' + s.key)}<span className="mono">{s.time}</span></th>)}
              <th scope="col" style={{ width: 44 }}><span className="sr-only">{t('meds.mar.more')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <div className={'drug' + (row.stoppedAt ? ' stopped' : '')}>{row.name}</div>
                  <div className="drug-sub">
                    {[row.form, row.route, row.indication].filter(Boolean).join(' · ')}
                  </div>
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {row.kind === 'temporary' && <span className="tag">{t('meds.kind.temporary')}</span>}
                    {row.requiresDoubleCheck && <span className="tag violet">{t('meds.fourEyes.tag')}</span>}
                    {row.stoppedAt && <span className="tag outline">{t('meds.mar.stoppedAt', { time: row.stoppedAt })}</span>}
                  </div>
                </th>
                {row.cells.map((c, i) => (
                  <td key={slots[i].time}>
                    {c ? (
                      <button
                        type="button"
                        className={'dose ' + (c.state === 'open' ? (c.over ? 'over' : '') : c.state)}
                        disabled={!editable || pending}
                        data-loading={isBusy(row.id, c.time) || undefined}
                        onClick={() => click(row, c)}
                        aria-label={`${row.name} ${doseText(c.dose, row.form)} ${t('meds.slots.' + slots[i].key)} ${c.time}: ${t('meds.state.' + (c.state === 'open' && c.over ? 'overdue' : c.state))}${c.state === 'given' ? ' ' + stateLabel(t, c) : ''}`}
                        title={c.note ?? undefined}
                      >
                        <b>{doseText(c.dose, row.form) || '–'}</b>
                        <span>{c.state === 'given' ? '✓ ' : c.state !== 'open' ? '✕ ' : ''}{stateLabel(t, c)}</span>
                      </button>
                    ) : (
                      <span className="nodose" aria-label={t('meds.mar.noDose')}>–</span>
                    )}
                  </td>
                ))}
                <td>
                  <button type="button" className="btn ghost sm" aria-label={t('meds.mar.moreFor', { drug: row.name })} title={t('meds.mar.more')}
                    onClick={() => setDlg({ row, time: (row.cells.find((c) => c && c.state === 'open' && c.applicable) ?? row.cells.find(Boolean))?.time ?? slots[0]?.time })}>
                    ⋯
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dlg && (
        <DoseDialog
          key={dlg.row.id + dlg.time}
          row={dlg.row}
          slots={slots}
          initialTime={dlg.time}
          initialStatus={dlg.status}
          day={day}
          editable={editable}
          resident={resident}
          colleagues={colleagues}
          onClose={() => setDlg(null)}
        />
      )}
    </>
  )
}

const ORDER: DoseStateDto[] = ['given', 'refused', 'omitted', 'held', 'open']
const SIGN: Record<DoseStateDto, string> = { given: '✓', refused: '✕', omitted: '–', held: 'Ⅱ', open: '↺' }

/** Detail einer Dosis: alle Zustände inkl. ausgelassen/pausiert mit Begründung, Vier-Augen, Verlauf. */
export function DoseDialog({ row, slots, initialTime, initialStatus, day, editable, resident, colleagues, onClose }: {
  row: MarRowDto
  slots: Slot[]
  initialTime: string
  initialStatus?: DoseStateDto
  day: string
  editable: boolean
  resident: ResidentCtxDto
  colleagues: ColleagueDto[]
  onClose: () => void
}) {
  const t = useT()
  const [time, setTime] = useState(initialTime)
  const idx = slots.findIndex((s) => s.time === time)
  const cell = row.cells[idx] ?? null
  const [status, setStatus] = useState<DoseStateDto>(initialStatus ?? (cell && cell.state === 'open' ? 'given' : cell?.state ?? 'given'))
  const options = ORDER.filter((s) => (s === 'open' ? !!cell && cell.state !== 'open' : true)).filter((s) => s !== 'given' || !!cell?.applicable || cell?.state === 'given')
  const needsReason = status === 'omitted' || status === 'held'
  const changed = !!cell && status !== cell.state
  return (
    <Dialog open onClose={onClose} title={t('meds.dialog.title')} context={<ResidentContext r={resident} />} wide>
      <div className="stack-sm">
        <div>
          <div className="drug">{row.name}</div>
          <div className="drug-sub">{[row.form, row.indication].filter(Boolean).join(' · ')}</div>
          {row.notes && <p className="small warn-text" style={{ margin: '4px 0 0' }}><span className="lbl warn-text">{t('meds.round.notes')}</span> {row.notes}</p>}
        </div>
        {row.cells.filter(Boolean).length > 1 && <div className="seg" role="group" aria-label={t('meds.dialog.slot')} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {slots.map((s, i) => row.cells[i] && (
            <button key={s.time} type="button" aria-pressed={s.time === time} onClick={() => { setTime(s.time); const c = row.cells[i]; setStatus(c && c.state === 'open' ? 'given' : c?.state ?? 'given') }}>
              {t('meds.slots.' + s.key)}{'\u00a0'}<span className="mono">{s.time}</span>
            </button>
          ))}
        </div>}
        {cell && (
          <dl className="kv">
            <dt>{t('meds.dialog.dose')}</dt><dd className="dose-big">{doseText(cell.dose, row.form) || '–'}</dd>
            <dt>{t('meds.dialog.route')}</dt><dd>{row.route}</dd>
            <dt>{t('meds.dialog.slot')}</dt><dd className="mono">{time}</dd>
            <dt>{t('meds.dialog.current')}</dt>
            <dd>
              <span className={'tag ' + (cell.state === 'given' ? 'ok' : cell.state === 'open' ? (cell.over ? 'crit' : '') : 'warn')}>{t('meds.state.' + (cell.state === 'open' && cell.over ? 'overdue' : cell.state))}</span>
              {cell.state !== 'open' && <span className="small muted"> {stateLabel(t, cell)}</span>}
              {cell.note && <div className="small fg2">{cell.note}</div>}
            </dd>
            {cell.history.length > 0 && (
              <>
                <dt>{t('meds.dialog.history')}</dt>
                <dd>
                  <ul className="small" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {cell.history.map((h) => (
                      <li key={h.id} className={h.voidedAt ? 'muted' : ''}>
                        <span className="mono">{h.at}</span> {t('meds.state.' + h.status)} · {h.by}{h.checkedBy ? ' / ' + h.checkedBy : ''}
                        {h.note ? ' · ' + h.note : ''}
                        {h.voidedAt && <> · <span style={{ textDecoration: 'line-through' }}>{t('meds.dialog.voided', { at: h.voidedAt, by: h.voidedBy ?? '' })}</span></>}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        )}
        {editable && cell ? (
          <ActionForm action={setDoseAction} onDone={(r) => r.ok && onClose()}>
            <input type="hidden" name="medicationId" value={row.id} />
            <input type="hidden" name="day" value={day} />
            <input type="hidden" name="time" value={time} />
            <input type="hidden" name="expectedId" value={cell.adminId} />
            <input type="hidden" name="status" value={status} />
            <div className="chips" role="radiogroup" aria-label={t('meds.dialog.newState')}>
              {options.map((s) => (
                <button key={s} type="button" role="radio" className="chip dose-opt" data-v={s} aria-checked={status === s} onClick={() => setStatus(s)}>
                  <span aria-hidden="true">{SIGN[s]}</span> {t('meds.action.' + s)}
                </button>
              ))}
            </div>
            {status !== 'open' && (
              <label className="fld">
                <span className="lbl">{t(needsReason ? 'meds.dialog.reason' : 'meds.dialog.note')}{!needsReason && <span style={{ textTransform: 'none', letterSpacing: 0 }}> ({t('common.optional')})</span>}</span>
                <textarea className="field" name="reason" rows={2} style={{ minHeight: 60 }} required={needsReason} placeholder={t(status === 'held' ? 'meds.dialog.reasonHeldPh' : status === 'omitted' ? 'meds.dialog.reasonOmittedPh' : status === 'refused' ? 'meds.dialog.reasonRefusedPh' : 'meds.dialog.notePh')} />
              </label>
            )}
            {status === 'refused' && <p className="small muted" style={{ margin: 0 }}>{t('meds.dialog.refusedHint')}</p>}
            {status === 'given' && row.requiresDoubleCheck && (
              <FourEyes colleagues={colleagues} summary={<><strong>{resident.name}</strong>{resident.room && <span className="mono">{t('meds.roomShort', { room: resident.room })}</span>} · {row.name} · <span className="mono">{doseText(cell.dose, row.form)}</span> · {row.route} · <span className="mono">{time}</span></>} />
            )}
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary" disabled={!changed}>{t('meds.dialog.save', { state: t('meds.state.' + status) })}</button>
            </div>
          </ActionForm>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>{t(cell ? 'meds.dialog.readOnly' : 'meds.mar.noDose')}</p>
        )}
      </div>
    </Dialog>
  )
}
