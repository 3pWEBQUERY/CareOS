'use client'

import { useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { givePrnAction, recordEffectAction, voidPrnAction } from '@/app/(app)/residents/[id]/meds/actions'
import { FourEyes, ResidentContext } from './shared'
import type { ColleagueDto, ResidentCtxDto } from './types'

export type PrnDto = {
  id: string
  name: string
  form: string | null
  route: string
  indication: string | null
  prnDose: string
  max: number | null
  minIntervalH: number | null
  count24: number
  lastAt: string | null
  nextAllowed: string | null
  full: boolean
  requiresDoubleCheck: boolean
  stock: number | null
  stockUnit: string | null
  low: boolean
}
export type PrnAdminDto = { id: string; drug: string; dose: string; at: string; by: string; note: string | null; voided: boolean; effect: string | null; mine: boolean }
export type EffectDto = { adminId: string; drug: string; dose: string; at: string; by: string; due: string; overdue: boolean }

export function PrnTable({ items, recent, canGive, resident, colleagues }: {
  items: PrnDto[]
  recent: PrnAdminDto[]
  canGive: boolean
  resident: ResidentCtxDto
  colleagues: ColleagueDto[]
}) {
  const t = useT()
  const [give, setGive] = useState<PrnDto | null>(null)
  const [voiding, setVoiding] = useState<PrnAdminDto | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  if (!items.length) return <p className="muted" style={{ margin: 0 }}>{t('meds.prn.none')}</p>
  return (
    <>
      <div className="tablewrap">
        <table className="stable">
          <thead>
            <tr>
              <th>{t('meds.prn.drug')}</th>
              <th>{t('meds.prn.indication')}</th>
              <th>{t('meds.prn.today')}</th>
              <th>{t('meds.prn.last')}</th>
              <th className="right"><span className="sr-only">{t('meds.prn.give')}</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id}>
                <td>
                  <div className="drug">{x.name}</div>
                  <div className="drug-sub">{[...new Set([x.prnDose, x.route].filter(Boolean))].join(' · ')}{x.minIntervalH ? ' · ' + t('meds.prn.interval', { h: x.minIntervalH }) : ''}</div>
                  {x.requiresDoubleCheck && <span className="tag violet" style={{ marginTop: 3 }}>{t('meds.fourEyes.tag')}</span>}
                </td>
                <td>{x.indication ?? '–'}</td>
                <td className="num nowrap">
                  <span className={x.full ? 'crit-text' : ''}>{x.max != null ? t('meds.prn.countOfMax', { n: x.count24, max: x.max }) : t('meds.prn.count', { n: x.count24 })}</span>
                  {x.low && <div className="small warn-text">{t('meds.stock.lowShort', { n: x.stock ?? 0, unit: x.stockUnit ?? '' })}</div>}
                </td>
                <td className="small">
                  {x.lastAt ?? '–'}
                  {x.nextAllowed && <div className="warn-text">{t('meds.prn.nextAt', { time: x.nextAllowed })}</div>}
                </td>
                <td className="right">
                  {canGive && (
                    <button type="button" className="btn sm" disabled={x.full} title={x.full ? t('meds.prn.maxReached') : undefined} onClick={() => setGive(x)}>
                      {x.full ? t('meds.prn.maxReached') : t('meds.prn.give')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recent.length > 0 && (
        <details>
          <summary className="small fg2" style={{ cursor: 'pointer' }}>{t('meds.prn.recent', { n: recent.filter((r) => !r.voided).length })}</summary>
          <ul className="list card" style={{ marginTop: 8 }}>
            {recent.map((a) => (
              <li key={a.id}>
                <div className="li">
                  <span className="mono small nowrap">{a.at}</span>
                  <div className="grow small">
                    <div style={a.voided ? { textDecoration: 'line-through', color: 'var(--fg-3)' } : undefined}>{a.drug} · <span className="mono">{a.dose}</span> · {a.by}</div>
                    {a.note && <div className="muted">{a.note}</div>}
                    {a.effect && <div className="fg2">{t('meds.effect.label')}: {a.effect}</div>}
                    {a.voided && <span className="tag outline">{t('meds.state.voided')}</span>}
                  </div>
                  {canGive && !a.voided && a.mine && <button type="button" className="linkbtn small" onClick={() => setVoiding(a)}>{t('meds.prn.void')}</button>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {give && (
        <Dialog open onClose={() => setGive(null)} title={t('meds.prn.dialogTitle')} context={<ResidentContext r={resident} />}>
          <ActionForm action={givePrnAction} onDone={(r) => r.ok && setGive(null)}>
            <input type="hidden" name="medicationId" value={give.id} />
            <div>
              <div className="drug">{give.name}</div>
              <div className="drug-sub">{[give.form, give.route, give.indication].filter(Boolean).join(' · ')}</div>
              <div className="small fg2 mono" style={{ marginTop: 2 }}>{give.max != null ? t('meds.prn.countOfMax', { n: give.count24, max: give.max }) : t('meds.prn.count', { n: give.count24 })}</div>
            </div>
            <div className="form-grid">
              <label className="fld">
                <span className="lbl">{t('meds.prn.dose')}</span>
                <input className="field mono" name="dose" defaultValue={give.prnDose} required />
                <span className="hint">{t('meds.prn.doseHint')}</span>
              </label>
              <div className="fld">
                <span className="lbl">{t('meds.dialog.route')}</span>
                <span style={{ paddingTop: 6 }}>{give.route}</span>
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="prn-reason">{t('meds.prn.reason')}</label>
              <textarea ref={reasonRef} id="prn-reason" className="field" name="reason" rows={2} style={{ minHeight: 60 }} required placeholder={give.indication ?? ''} />
              {give.indication && (
                <div className="row" style={{ gap: 6 }}>
                  <span className="small muted">{t('meds.prn.asIndicated')}</span>
                  <button type="button" className="snip" onClick={() => { const el = reasonRef.current; if (el) { el.value = give.indication ?? ''; el.focus() } }}>{give.indication}</button>
                </div>
              )}
            </div>
            {give.nextAllowed && (
              <>
                <div className="alert warn" role="alert"><span className="grow"><strong>{t('meds.prn.intervalWarn', { h: give.minIntervalH ?? 0 })}</strong>{t('meds.prn.intervalWarnText', { time: give.nextAllowed })}</span></div>
                <label className="fld">
                  <span className="lbl">{t('meds.prn.override')}</span>
                  <input className="field" name="override" required placeholder={t('meds.prn.overridePh')} />
                </label>
              </>
            )}
            {give.requiresDoubleCheck && <FourEyes colleagues={colleagues} summary={<><strong>{resident.name}</strong>{resident.room && <span className="mono">{t('meds.roomShort', { room: resident.room })}</span>} · {give.name} · <span className="mono">{give.prnDose}</span> · {give.route}</>} />}
            <p className="small muted" style={{ margin: 0 }}>{t('meds.prn.effectHint')}</p>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setGive(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('meds.prn.confirm')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
      {voiding && (
        <Dialog open onClose={() => setVoiding(null)} title={t('meds.prn.voidTitle')} context={<ResidentContext r={resident} />}>
          <ActionForm action={voidPrnAction} onDone={(r) => r.ok && setVoiding(null)} confirm="meds.prn.voidConfirm">
            <input type="hidden" name="adminId" value={voiding.id} />
            <p style={{ margin: 0 }}><span className="mono">{voiding.at}</span> · {voiding.drug} · <span className="mono">{voiding.dose}</span></p>
            <label className="fld">
              <span className="lbl">{t('meds.dialog.reason')}</span>
              <input className="field" name="reason" required placeholder={t('meds.prn.voidPh')} />
            </label>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setVoiding(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn danger">{t('meds.prn.void')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Offene Wirkungskontrollen nach Reserveabgabe. */
export function EffectChecks({ items, canRecord, resident }: { items: EffectDto[]; canRecord: boolean; resident: ResidentCtxDto }) {
  const t = useT()
  const [open, setOpen] = useState<EffectDto | null>(null)
  const [effect, setEffect] = useState('effective')
  if (!items.length) return null
  return (
    <section className="card warn" id="effect" aria-labelledby="effect-h">
      <div className="card-head">
        <h3 id="effect-h"><span className="tag warn">{t('meds.effect.open')}</span></h3>
        <span className="pill warn">{items.length}</span>
      </div>
      <ul className="list">
        {items.map((e) => (
          <li key={e.adminId}>
            <div className="li">
              <div className="grow">
                <div>{e.drug} <span className="mono small fg2">{e.dose}</span></div>
                <div className={'small ' + (e.overdue ? 'crit-text' : 'muted')}>{t('meds.effect.givenAt', { at: e.at, by: e.by })} · {t(e.overdue ? 'meds.effect.overdueSince' : 'meds.effect.dueAt', { time: e.due })}</div>
              </div>
              {canRecord && <button type="button" className="btn sm" onClick={() => { setEffect('effective'); setOpen(e) }}>{t('meds.effect.record')}</button>}
            </div>
          </li>
        ))}
      </ul>
      {open && (
        <Dialog open onClose={() => setOpen(null)} title={t('meds.effect.title')} context={<ResidentContext r={resident} />}>
          <ActionForm action={recordEffectAction} onDone={(r) => r.ok && setOpen(null)}>
            <input type="hidden" name="adminId" value={open.adminId} />
            <input type="hidden" name="effect" value={effect} />
            <p style={{ margin: 0 }}>{open.drug} <span className="mono">{open.dose}</span> · <span className="small muted">{t('meds.effect.givenAt', { at: open.at, by: open.by })}</span></p>
            <div className="quickdoc" role="radiogroup" aria-label={t('meds.effect.label')}>
              {(['effective', 'partial', 'none'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={effect === k} aria-pressed={effect === k} data-v={k === 'effective' ? 'done' : k === 'partial' ? 'partial' : 'skipped'} onClick={() => setEffect(k)}>
                  <span aria-hidden="true">{k === 'effective' ? '✓' : k === 'partial' ? '△' : '✕'}</span>{t('meds.effect.' + k)}
                </button>
              ))}
            </div>
            <label className="fld">
              <span className="lbl">{t('meds.effect.note')}{effect === 'effective' && <span style={{ textTransform: 'none', letterSpacing: 0 }}> ({t('common.optional')})</span>}</span>
              <textarea className="field" name="note" rows={2} style={{ minHeight: 60 }} required={effect !== 'effective'} placeholder={t('meds.effect.notePh')} />
            </label>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </section>
  )
}
