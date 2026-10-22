'use client'

import { useRef, useState, useTransition } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { fmtNum } from '@/lib/time'
import { toast } from '@/components/toast'
import { ActionForm } from '@/components/ui/ActionForm'
import { recordVitals, saveThresholds } from './actions'
import { isQueued, orQueue } from '@/lib/offline/client'
import { NumberField, TextField } from '@/components/ui/fields'

type Field = { key: string; label: string; unit: string; min: number; max: number; dec: number; lo: number; hi: number }

const PH: Record<string, number> = { temp: 36.8, glucose: 6.5, weight: 62 }

export function VitalForm({ residentId, fields, who }: { residentId: string; fields: Field[]; who?: string }) {
  const t = useT()
  const locale = useLocale()
  const ref = useRef<HTMLFormElement>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [warn, setWarn] = useState<string[] | null>(null)
  const [pending, start] = useTransition()
  // Sofortige Rückmeldung am Feld (PRD §32) übernimmt NumberField: unplausibel (min/max) = Fehler, ausserhalb Referenz = Hinweis ▲/▼
  const nf = (v: number, dec: number) => fmtNum(v, dec, locale) // Dezimalkomma wie in der Verlaufstabelle

  const parse = () => {
    const out: Record<string, number> = {}
    for (const f of fields) {
      const raw = (vals[f.key] ?? '').trim().replace(',', '.')
      if (!raw) continue
      const v = Number(raw)
      if (!Number.isFinite(v) || v < f.min || v > f.max) {
        return { error: { msg: t('chart.vitals.errors.implausible', { label: f.label, value: vals[f.key], min: f.min, max: f.max, unit: f.unit }), field: f.key } }
      }
      out[f.key] = v
    }
    if ((out.sys == null) !== (out.dia == null)) return { error: { msg: t('chart.vitals.errors.bpPair'), field: out.sys == null ? 'sys' : 'dia' } }
    if (out.sys != null && out.dia >= out.sys) return { error: { msg: t('chart.vitals.errors.bpOrder'), field: 'dia' } }
    if (!Object.keys(out).length) return { error: { msg: t('chart.vitals.errors.none'), field: fields[0]?.key } }
    return { out }
  }

  const submit = (confirmed: boolean) => {
    const p = parse()
    if (p.error) {
      setErr(p.error); setWarn(null)
      if (p.error.field) ref.current?.querySelector<HTMLInputElement>('#v_' + p.error.field)?.focus()
      return
    }
    setErr(null)
    const out = p.out!
    if (!confirmed) {
      const w = fields.filter((f) => f.key !== 'weight' && out[f.key] != null && (out[f.key] < f.lo || out[f.key] > f.hi))
        .map((f) => `${f.label} ${nf(out[f.key], f.dec)} ${f.unit} ${out[f.key] > f.hi ? '▲' : '▼'} (${t('chart.vitals.refShort')} ${nf(f.lo, f.dec)}–${nf(f.hi, f.dec)})`)
      if (w.length) { setWarn(w); return }
    }
    const form = new FormData(ref.current!)
    start(async () => {
      // Ohne Verbindung: verschlüsselt vormerken und später synchronisieren (PRD §39)
      const note = String(form.get('note') ?? '').trim().slice(0, 500) || null
      // Eigene Parameter (x_<key>) getrennt vormerken – sie werden beim Synchronisieren gegen die Organisationsdefinition geprüft
      const std = Object.fromEntries(Object.entries(out).filter(([k]) => !k.startsWith('x_')))
      const extra = Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith('x_')).map(([k, v]) => [k.slice(2), v]))
      const r = await orQueue(() => recordVitals(residentId, form), { kind: 'vitals', residentId, data: { values: std, note, ...(Object.keys(extra).length ? { extra } : {}) } }, { who })
      if (isQueued(r)) { setVals({}); setWarn(null); toast(t(r.message)); return }
      if (!r.ok) {
        setErr({ msg: /^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error, field: r.field })
        return
      }
      setVals({}); setWarn(null)
      // Der Absende-Knopf war während des Speicherns deaktiviert: Fokus für die nächste Messung ins erste Feld
      ref.current?.querySelector<HTMLInputElement>('input.field')?.focus()
      toast(t('chart.vitals.saved') + (r.data?.abnormal ? ' · ' + t('chart.vitals.savedAbnormal', { n: r.data.abnormal }) : ''))
    })
  }

  // Meldungen zu einem Messwert stehen am Feld; unten nur allgemeine
  const dupErr = !!err?.field && fields.some((f) => f.key === err.field)
  return (
    <form ref={ref} className="vform" noValidate onSubmit={(e) => { e.preventDefault(); submit(false) }}>
      {fields.map((f) => (
        <NumberField
          key={f.key} id={'v_' + f.key} name={f.key} label={f.label} unit={f.unit} min={f.min} max={f.max}
          placeholder={PH[f.key] != null ? nf(PH[f.key], f.dec) : ''}
          value={vals[f.key] ? Number(vals[f.key]) : ''}
          onChange={(v) => { setVals((cur) => ({ ...cur, [f.key]: v === '' ? '' : String(v) })); setWarn(null); if (err?.field === f.key) setErr(null) }}
          // Ausserhalb des Referenzbereichs: Hinweis ▲/▼ am Feld (PRD §32), Gewicht ohne Referenz
          warn={f.key !== 'weight' ? { lo: f.lo, hi: f.hi } : undefined}
          warnText={(d) => `${d === 'high' ? '▲' : '▼'} ${t('chart.vitals.refShort')} ${nf(f.lo, f.dec)}–${nf(f.hi, f.dec)}`}
          error={err?.field === f.key ? err.msg : undefined}
        />
      ))}
      <TextField label={t('chart.vitals.note')} wrapStyle={{ gridColumn: 'span 2' }} id="v_note" name="note" autoComplete="off" maxLength={500} style={{ fontFamily: 'var(--font-ui)' }} />
      {warn && (
        <div className="alert warn" role="alert" style={{ gridColumn: '1 / -1' }}>
          <div className="grow">
            <strong>{t('chart.vitals.warnTitle')}</strong>
            <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>{warn.map((w) => <li key={w} className="mono">{w}</li>)}</ul>
            <div className="row">
              <button type="button" className="btn sm primary" onClick={() => submit(true)} data-loading={pending || undefined}>{t('chart.vitals.warnConfirm')}</button>
              <button type="button" className="btn sm" onClick={() => setWarn(null)}>{t('chart.vitals.warnCheck')}</button>
            </div>
          </div>
        </div>
      )}
      <div className="actions">
        <button className="btn primary" type="submit" data-loading={pending || undefined} disabled={pending}>{t('chart.vitals.save')}</button>
        <span className="small muted">{t('chart.vitals.formHint')}</span>
        {err && !dupErr && <span className="err" id="v_err" role="alert">{err.msg}</span>}
      </div>
    </form>
  )
}

type Th = { key: string; label: string; unit: string; dec: number; lo: number; hi: number; orgLo: number; orgHi: number; individual: boolean }

export function Thresholds({ residentId, rows, canEdit }: { residentId: string; rows: Th[]; canEdit: boolean }) {
  const t = useT()
  const locale = useLocale()
  const nf = (v: number, dec: number) => fmtNum(v, dec, locale) // Dezimalkomma wie in der Verlaufstabelle
  const [edit, setEdit] = useState(false)
  const n = rows.filter((r) => r.individual).length
  return (
    <section className="card" aria-labelledby="thr">
      <div className="card-head">
        <h2 id="thr">{t('chart.vitals.thresholds')}</h2>
        <div className="row">
          <span className="small muted">{n ? t('chart.vitals.thresholdsN', { n }) : t('chart.vitals.thresholdsOrg')}</span>
          {canEdit && !edit && <button type="button" className="btn sm" onClick={() => setEdit(true)}>{t('common.edit')}</button>}
        </div>
      </div>
      <ActionForm action={saveThresholds.bind(null, residentId)} success="chart.vitals.thresholdsSaved" reset={false} className="stack-sm" onDone={(r) => r.ok && setEdit(false)}>
        <div style={{ overflowX: 'auto' }} data-scroll>
          <table className="stable">
            <thead><tr><th>{t('chart.vitals.value')}</th><th>{t('chart.vitals.orgRange')}</th><th>{t('chart.vitals.individualLo')}</th><th>{t('chart.vitals.individualHi')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th>{r.label} <span className="muted small">{r.unit}</span></th>
                  <td className="num">{nf(r.orgLo, r.dec)}–{nf(r.orgHi, r.dec)}</td>
                  {edit ? (
                    <>
                      <td><NumberField name={'lo_' + r.key} defaultValue={r.individual ? r.lo : ''} placeholder={nf(r.orgLo, r.dec)} style={{ maxWidth: 110 }} aria-label={`${r.label} ${t('chart.vitals.individualLo')}`} /></td>
                      <td><NumberField name={'hi_' + r.key} defaultValue={r.individual ? r.hi : ''} placeholder={nf(r.orgHi, r.dec)} style={{ maxWidth: 110 }} aria-label={`${r.label} ${t('chart.vitals.individualHi')}`} /></td>
                    </>
                  ) : (
                    <td colSpan={2} className="num">{r.individual ? <><span className="tag accent" style={{ marginRight: 8 }}>{t('chart.vitals.individualTag')}</span>{nf(r.lo, r.dec)}–{nf(r.hi, r.dec)}</> : <span className="muted">–</span>}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {edit && (
          <div className="form-actions" style={{ padding: '0 12px 12px' }}>
            <span className="small muted">{t('chart.vitals.thresholdsHint')}</span><span className="spacer" />
            <button type="button" className="btn" onClick={() => setEdit(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn primary">{t('common.save')}</button>
          </div>
        )}
      </ActionForm>
    </section>
  )
}
