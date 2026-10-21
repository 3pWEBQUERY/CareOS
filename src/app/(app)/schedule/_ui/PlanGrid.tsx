'use client'

import { Fragment, useState } from 'react'
import { useT } from '@/i18n/client'
import { ShiftDialog, type ShiftDraft, type ShiftType, type StaffOpt } from './ShiftDialog'

export type GridShift = { id: string; typeId: string; code: string; userId: string | null; status: string; note: string | null; req: string | null; dateKey: string }
export type GridDay = { key: string; label: string; today: boolean }
export type GridRow = { id: string; name: string; qual: string; job: string; hours: number }
export type GridCov = { code: string; n: number; target: number; hf: boolean; open: number }

/**
 * Teamplan (Woche): Zeilen Mitarbeitende, Spalten Tage. Zellen zeigen Dienste (F/S/N), Abwesenheiten und offene Dienste.
 * Unten Besetzung Ist/Soll und Qualifikationsabdeckung. Leitung kann Dienste anlegen und bearbeiten.
 */
export function PlanGrid({ days, rows, shifts, absences, coverage, types, staff, quals, unitId, keyQual, canManage }: {
  days: GridDay[]
  rows: GridRow[]
  shifts: GridShift[]
  absences: Record<string, { label: string; title: string; pending: boolean }>
  coverage: Record<string, GridCov[]>
  types: ShiftType[]
  staff: StaffOpt[]
  quals: string[]
  unitId: string
  keyQual: string | null
  canManage: boolean
}) {
  const t = useT()
  const [draft, setDraft] = useState<ShiftDraft | null>(null)
  const typeCode = new Map(types.map((x) => [x.id, x]))
  const at = (userId: string | null, day: string) => shifts.filter((s) => s.userId === userId && s.dateKey === day)
  const chip = (s: GridShift) => {
    const ty = typeCode.get(s.typeId)
    const cls = 'sh ' + (s.userId ? s.code : 'open')
    const label = (
      <>
        {s.code}
        {s.status === 'swap_requested' && <span aria-label={t('schedule.status.swap_requested')} title={t('schedule.status.swap_requested')}>⇄</span>}
        {s.req && !s.userId && <span className="small">{s.req.split(' ').pop()}</span>}
      </>
    )
    const title = `${ty?.name ?? s.code} ${ty?.start ?? ''}–${ty?.end ?? ''}${s.note ? ' · ' + s.note : ''}${s.status === 'swap_requested' ? ' · ' + t('schedule.status.swap_requested') : ''}`
    return canManage ? (
      <button key={s.id} type="button" className={cls + ' sh-btn'} title={title} onClick={() => setDraft({ id: s.id, typeId: s.typeId, userId: s.userId, date: s.dateKey, req: s.req, note: s.note })}>{label}</button>
    ) : (
      <span key={s.id} className={cls} title={title}>{label}</span>
    )
  }
  const addBtn = (userId: string | null, day: string) =>
    canManage ? (
      <button type="button" className="cal-add" aria-label={t('schedule.plan.add')} title={t('schedule.plan.add')} onClick={() => setDraft({ userId, date: day })}>+</button>
    ) : null

  return (
    <>
      <div className="tablewrap">
        <div className="cal" role="grid" aria-label={t('schedule.plan.title')}>
          <div className="ch rh">{t('schedule.plan.staff')}</div>
          {days.map((d) => <div key={d.key} className={'ch' + (d.today ? ' today' : '')}>{d.label}</div>)}

          {rows.map((r) => (
            <Fragment key={r.id}>
              <div className="rh">
                <div className="ellipsis">{r.name}</div>
                <div className="small muted ellipsis" style={{ fontWeight: 400 }}>{r.qual || r.job}{r.hours ? ` · ${r.hours} h` : ''}</div>
              </div>
              {days.map((d) => {
                const abs = absences[`${r.id}|${d.key}`]
                const list = at(r.id, d.key)
                return (
                  <div key={d.key} className={'cal-cell' + (d.today ? ' today-col' : '')}>
                    {abs && <span className="sh abs" title={abs.title}>{abs.label}{abs.pending ? ' ?' : ''}</span>}
                    {list.map(chip)}
                    {!list.length && addBtn(r.id, d.key)}
                  </div>
                )
              })}
            </Fragment>
          ))}

          <div className="rh cal-sep">{t('schedule.plan.openRow')}</div>
          {days.map((d) => (
            <div key={d.key} className={'cal-cell cal-sep' + (d.today ? ' today-col' : '')}>
              {at(null, d.key).map(chip)}
              {addBtn(null, d.key)}
            </div>
          ))}

          <div className="rh cal-sep"><span className="lbl">{t('schedule.plan.coverage')}</span></div>
          {days.map((d) => (
            <div key={d.key} className={'cal-cell cal-sep' + (d.today ? ' today-col' : '')}>
              {(coverage[d.key] ?? []).map((c) => {
                const under = c.n < c.target
                return (
                  <span key={c.code} className={'cov mono' + (under ? ' under' : '')} title={t('schedule.coverage.cell', { code: c.code, n: c.n, target: c.target })}>
                    {c.code} {c.n}/{c.target}{under ? ' ▼' : ''}
                  </span>
                )
              })}
            </div>
          ))}
          {keyQual && (
            <>
              <div className="rh"><span className="lbl">{keyQual}</span></div>
              {days.map((d) => (
                <div key={d.key} className={'cal-cell' + (d.today ? ' today-col' : '')}>
                  {(coverage[d.key] ?? []).map((c) => (
                    <span key={c.code} className={'cov mono' + (c.hf ? ' ok' : c.target > 0 ? ' under' : '')} title={c.hf ? t('schedule.coverage.qualOk', { qual: keyQual }) : t('schedule.coverage.qualMissing', { qual: keyQual })}>
                      {c.code} {c.hf ? '✓' : '✕'}
                    </span>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="mlegend">
        {types.map((x) => <span key={x.id}><span className={'sh ' + x.code}>{x.code}</span> {x.name} <span className="mono">{x.start}–{x.end}</span></span>)}
        <span><span className="sh open">F</span> {t('schedule.plan.legendOpen')}</span>
        <span><span className="sh abs">{t('schedule.absence.short.vacation')}</span> {t('schedule.plan.legendAbsence')}</span>
        <span>⇄ {t('schedule.status.swap_requested')}</span>
        <span className="mono">▼</span> <span>{t('schedule.coverage.under')}</span>
      </div>
      {canManage && <ShiftDialog draft={draft} onClose={() => setDraft(null)} types={types} staff={staff} quals={quals} unitId={unitId} />}
    </>
  )
}
