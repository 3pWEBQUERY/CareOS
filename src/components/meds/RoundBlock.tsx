'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { setDoseAction } from '@/app/(app)/residents/[id]/meds/actions'
import { DoseDialog, stateLabel } from './MarTable'
import { useCall } from './shared'
import type { ColleagueDto, DoseStateDto, MarRowDto, ResidentCtxDto } from './types'

export type RoundResidentDto = {
  resident: ResidentCtxDto
  risks: string[]
  lines: MarRowDto[]
}

/** Ein Block pro Person in der Medikamentenrunde (PRD §13.2). Gleiche Server Actions wie die Abgabeliste. */
export function RoundBlock({ data, time, slotKey, day, editable, colleagues }: {
  data: RoundResidentDto
  time: string
  slotKey: string
  day: string
  editable: boolean
  colleagues: ColleagueDto[]
}) {
  const t = useT()
  const { pending, call } = useCall()
  const [dlg, setDlg] = useState<{ row: MarRowDto; status: DoseStateDto } | null>(null)
  const slots = [{ time, key: slotKey }]
  const cells = data.lines.map((l) => l.cells[0]!)
  const documented = cells.filter((c) => c.state !== 'open').length
  const complete = documented === cells.length
  const r = data.resident

  const act = (row: MarRowDto, status: DoseStateDto) => {
    const c = row.cells[0]!
    if (status === 'given' && row.requiresDoubleCheck) return setDlg({ row, status })
    if (status === 'omitted' || status === 'held') return setDlg({ row, status })
    if (status === 'open' && !window.confirm(t('meds.round.resetConfirm', { drug: row.name }))) return
    call(setDoseAction, { medicationId: row.id, day, time, status, expectedId: c.adminId })
  }

  return (
    <section className={'round-res' + (complete ? ' done' : '')} aria-labelledby={'rr-' + r.id}>
      <header>
        {r.room && <span className="room">{r.room}</span>}
        <h2 id={'rr-' + r.id}>{r.name}</h2>
        {r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>)}
        {data.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
        <span className="grow" />
        <span className={'tag ' + (complete ? 'ok' : 'outline')}>{complete ? t('meds.round.complete') : t('meds.round.documented', { n: documented, total: cells.length })}</span>
      </header>
      {data.lines.map((row) => {
        const c = row.cells[0]!
        return (
          <div key={row.id} className="round-line">
            <div style={{ minWidth: 0 }}>
              <div className="drug">{row.name}</div>
              <div className="drug-sub">{[row.form, row.indication].filter(Boolean).join(' · ')}</div>
              {row.notes && <div className="small warn-text">{row.notes}</div>}
              {row.requiresDoubleCheck && <span className="tag violet" style={{ marginTop: 3 }}>{t('meds.fourEyes.tag')}</span>}
            </div>
            <div className="dosev">{c.dose}</div>
            <div className="small">
              <div className="mono">{time}</div>
              <div className="fg2">{row.route}</div>
            </div>
            <div className="round-act">
              {c.state === 'open' ? (
                editable && (
                  <>
                    <button type="button" className="btn lg primary" disabled={pending} onClick={() => act(row, 'given')}>{t('meds.action.given')}</button>
                    <button type="button" className="btn lg" disabled={pending} onClick={() => act(row, 'refused')}>{t('meds.action.refused')}</button>
                    <button type="button" className="btn lg" disabled={pending} onClick={() => act(row, 'omitted')}>{t('meds.action.omitted')}</button>
                  </>
                )
              ) : (
                <>
                  <span className={'tag ' + (c.state === 'given' ? 'ok' : 'warn')} style={{ fontSize: 12 }}>
                    {c.state === 'given' ? '✓ ' : ''}{t('meds.state.' + c.state)}
                  </span>
                  <span className="small muted mono">{c.state === 'given' ? stateLabel(t, c) : [c.at, c.by].filter(Boolean).join(' ')}</span>
                  {editable && <button type="button" className="btn ghost sm" disabled={pending} onClick={() => act(row, 'open')}>{t('meds.round.reset')}</button>}
                </>
              )}
            </div>
            {c.state === 'open' && c.over && <div className="small crit-text" style={{ gridColumn: '1 / -1', marginTop: -6 }}>{t('meds.round.overdue', { time })}</div>}
          </div>
        )
      })}
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
    </section>
  )
}
