'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { NumberField, Select, TextField } from '@/components/ui/fields'
import { saveCustomVitals } from '@/app/(app)/residents/_lib/custom-vitals-actions'
import { CUSTOM_MAX, type CustomVital } from '@/lib/vitals-custom'

type Row = { key: string; label: string; unit: string; dec: number; min: number | ''; max: number | ''; lo: number | ''; hi: number | '' }
const toRow = (d: CustomVital): Row => ({ key: d.key, label: d.label, unit: d.unit, dec: d.dec, min: d.min, max: d.max, lo: d.lo ?? '', hi: d.hi ?? '' })

/**
 * Eigene Vitalparameter der Organisation (PRD §45): Bezeichnung, Einheit, Dezimalstellen, Plausibilitätsgrenzen
 * (Eingabe ausserhalb wird abgewiesen) und optionaler Referenzbereich (Werte ausserhalb werden markiert).
 * Für die Klinische Konfiguration gedacht; ohne Berechtigung admin.config nicht sichtbar.
 */
export function CustomVitalsEditor({ defs }: { defs: CustomVital[] }) {
  const t = useT()
  const [edit, setEdit] = useState(false)
  const [rows, setRows] = useState<Row[]>(defs.map(toRow))
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (i: number, patch: Partial<Row>) => setRows((c) => c.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const save = () => start(async () => {
    const payload = rows.map((r) => ({ ...r, min: r.min === '' ? null : r.min, max: r.max === '' ? null : r.max, lo: r.lo === '' ? null : r.lo, hi: r.hi === '' ? null : r.hi }))
    const res = await saveCustomVitals(payload)
    if (!res.ok) return setErr(/^[a-z]+\.[\w.]+$/.test(res.error) ? t(res.error) : res.error)
    setErr(null); setEdit(false); toast(t('chart.custom.saved'))
  })
  return (
    <section className="card" aria-labelledby="cv-h">
      <div className="card-head">
        <h2 id="cv-h">{t('chart.custom.title')}</h2>
        <div className="row">
          <span className="small muted">{defs.length ? t('chart.custom.count', { n: defs.length }) : t('chart.custom.none')}</span>
          {!edit && <button type="button" className="btn sm" onClick={() => { setRows(defs.map(toRow)); setEdit(true) }}>{t('common.edit')}</button>}
        </div>
      </div>
      <div className="card-body stack-sm">
        <p className="small muted" style={{ margin: 0 }}>{t('chart.custom.hint')}</p>
        {!edit ? (
          defs.length > 0 && (
            <ul className="list">
              {defs.map((d) => <li key={d.key}><div className="li"><span className="grow">{d.label} <span className="muted small">{d.unit}</span></span><span className="mono small">{d.min}–{d.max}{d.lo != null || d.hi != null ? ` · ${t('chart.custom.ref')} ${d.lo ?? '…'}–${d.hi ?? '…'}` : ''}</span></div></li>)}
            </ul>
          )
        ) : (
          <>
            {rows.map((r, i) => (
              <fieldset key={i} className="cv-row">
                <legend className="sr-only">{t('chart.custom.param', { n: i + 1 })}</legend>
                <TextField label={t('chart.custom.label')} value={r.label} maxLength={60} required onChange={(e) => set(i, { label: e.target.value })} />
                <TextField label={t('chart.custom.unit')} value={r.unit} maxLength={16} onChange={(e) => set(i, { unit: e.target.value })} />
                <Select label={t('chart.custom.dec')} value={String(r.dec)} onChange={(e) => set(i, { dec: Number(e.target.value) })}>
                  {[0, 1, 2].map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
                <NumberField label={t('chart.custom.min')} value={r.min} onChange={(v) => set(i, { min: v === '' ? '' : Number(v) })} />
                <NumberField label={t('chart.custom.max')} value={r.max} onChange={(v) => set(i, { max: v === '' ? '' : Number(v) })} />
                <NumberField label={t('chart.custom.lo')} optional value={r.lo} onChange={(v) => set(i, { lo: v === '' ? '' : Number(v) })} />
                <NumberField label={t('chart.custom.hi')} optional value={r.hi} onChange={(v) => set(i, { hi: v === '' ? '' : Number(v) })} />
                <button type="button" className="btn sm ghost" onClick={() => setRows((c) => c.filter((_, j) => j !== i))}>{t('chart.custom.remove')}</button>
              </fieldset>
            ))}
            {rows.length < CUSTOM_MAX && <div><button type="button" className="btn sm" onClick={() => setRows((c) => [...c, { key: '', label: '', unit: '', dec: 0, min: '', max: '', lo: '', hi: '' }])}>{t('chart.custom.add')}</button></div>}
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
            <div className="form-actions">
              <span className="small muted">{t('chart.custom.keepHint')}</span><span className="spacer" />
              <button type="button" className="btn" onClick={() => { setEdit(false); setErr(null) }}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={save} disabled={pending} data-loading={pending || undefined}>{t('common.save')}</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
