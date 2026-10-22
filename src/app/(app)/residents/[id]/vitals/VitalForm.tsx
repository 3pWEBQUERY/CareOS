'use client'

import { useRef, useState, useTransition } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { toast } from '@/components/toast'
import { ActionForm } from '@/components/ui/ActionForm'
import { recordVitals, saveThresholds } from './actions'
import { isQueued, orQueue } from '@/lib/offline/client'

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
  // Sofortige Rückmeldung direkt am Feld (PRD §32): unplausibel = Fehler, ausserhalb Referenz = Hinweis ▲/▼
  const [hint, setHint] = useState<Record<string, { kind: 'err' | 'warn'; text: string }>>({})
  const check = (f: Field) => {
    const raw = (vals[f.key] ?? '').trim().replace(',', '.')
    const v = Number(raw)
    let h: { kind: 'err' | 'warn'; text: string } | null = null
    if (raw && (!Number.isFinite(v) || v < f.min || v > f.max)) h = { kind: 'err', text: t('chart.vitals.errors.implausible', { label: f.label, value: vals[f.key] ?? '', min: f.min, max: f.max, unit: f.unit }) }
    else if (raw && f.key !== 'weight' && (v < f.lo || v > f.hi)) h = { kind: 'warn', text: `${v > f.hi ? '▲' : '▼'} ${t('chart.vitals.refShort')} ${nf(f.lo, f.dec)}–${nf(f.hi, f.dec)}` }
    setHint((cur) => { const n = { ...cur }; if (h) n[f.key] = h; else delete n[f.key]; return n })
  }
  const nf = (v: number, dec: number) => new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)

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
      if (p.error.field) (ref.current?.querySelector(`[name="${p.error.field}"]`) as HTMLInputElement | null)?.focus()
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
      const r = await orQueue(() => recordVitals(residentId, form), { kind: 'vitals', residentId, data: { values: out, note } }, { who })
      if (isQueued(r)) { setVals({}); setHint({}); setWarn(null); toast(t(r.message)); return }
      if (!r.ok) {
        setErr({ msg: /^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error, field: r.field })
        return
      }
      setVals({}); setHint({}); setWarn(null)
      // Der Absende-Knopf war während des Speicherns deaktiviert: Fokus für die nächste Messung ins erste Feld
      ref.current?.querySelector<HTMLInputElement>('input.field')?.focus()
      toast(t('chart.vitals.saved') + (r.data?.abnormal ? ' · ' + t('chart.vitals.savedAbnormal', { n: r.data.abnormal }) : ''))
    })
  }

  // Dieselbe Meldung steht bereits am Feld (Live-Region dort): nicht ein zweites Mal ausgeben/vorlesen
  const dupErr = !!err?.field && hint[err.field]?.text === err.msg
  return (
    <form ref={ref} className="vform" noValidate onSubmit={(e) => { e.preventDefault(); submit(false) }}>
      {fields.map((f) => (
        <label key={f.key} htmlFor={'v_' + f.key}>
          <span className="lbl">{f.label} <span style={{ textTransform: 'none', letterSpacing: 0 }}>{f.unit}</span></span>
          <input
            className="field" id={'v_' + f.key} name={f.key} inputMode="decimal" autoComplete="off" placeholder={PH[f.key] != null ? nf(PH[f.key], f.dec) : ''}
            value={vals[f.key] ?? ''} aria-invalid={err?.field === f.key || hint[f.key]?.kind === 'err' || undefined}
            aria-describedby={[hint[f.key] && 'vh_' + f.key, err?.field === f.key && !dupErr && 'v_err'].filter(Boolean).join(' ') || undefined}
            onChange={(e) => { setVals((v) => ({ ...v, [f.key]: e.target.value })); setWarn(null); if (hint[f.key]) setHint((cur) => { const n = { ...cur }; delete n[f.key]; return n }) }}
            onBlur={() => check(f)}
          />
          {hint[f.key] && <span id={'vh_' + f.key} className={'small mono ' + (hint[f.key].kind === 'err' ? 'crit-text' : 'warn-text')} role={hint[f.key].kind === 'err' ? 'alert' : undefined}>{hint[f.key].text}</span>}
        </label>
      ))}
      <label htmlFor="v_note" style={{ gridColumn: 'span 2' }}>
        <span className="lbl">{t('chart.vitals.note')}</span>
        <input className="field" id="v_note" name="note" autoComplete="off" maxLength={500} style={{ fontFamily: 'var(--font-ui)' }} />
      </label>
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
  const nf = (v: number, dec: number) => new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
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
                      <td><input className="field mono" name={'lo_' + r.key} inputMode="decimal" defaultValue={r.individual ? nf(r.lo, r.dec) : ''} placeholder={nf(r.orgLo, r.dec)} style={{ maxWidth: 110 }} aria-label={`${r.label} ${t('chart.vitals.individualLo')}`} /></td>
                      <td><input className="field mono" name={'hi_' + r.key} inputMode="decimal" defaultValue={r.individual ? nf(r.hi, r.dec) : ''} placeholder={nf(r.orgHi, r.dec)} style={{ maxWidth: 110 }} aria-label={`${r.label} ${t('chart.vitals.individualHi')}`} /></td>
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
