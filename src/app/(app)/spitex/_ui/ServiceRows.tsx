'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { NumberField, Select, TextField } from '@/components/ui/fields'
import { Tooltip } from '@/components/ui/Tooltip'
import { IconClose } from '@/components/icons'
import { KLV_KEYS, MAX_SERVICES, SERVICE_PRESETS } from '@/lib/spitex'

export type ServiceDto = { klv: string; label: string; minutes: number }

/**
 * Leistungen eines Einsatzes bzw. einer Wochenvorlage: je Zeile KLV-Kategorie, Bezeichnung und geplante Minuten
 * (Formularfelder svc_klv / svc_label / svc_min). Vorschläge fügen eine vorbelegte Zeile an.
 */
export function ServiceRows({ initial }: { initial?: ServiceDto[] }) {
  const t = useT()
  let next = 0
  const [rows, setRows] = useState(() => (initial?.length ? initial : []).map((s) => ({ ...s, key: next++ })))
  const [seq, setSeq] = useState(next)
  const add = (s: ServiceDto) => {
    if (rows.length >= MAX_SERVICES) return
    setRows((r) => [...r, { ...s, key: seq }])
    setSeq((n) => n + 1)
  }
  const total = rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0)
  return (
    <fieldset className="sx-svc span-all">
      <legend className="lbl">{t('spitex.form.services')}{rows.length > 0 && <span className="mono"> · {t('spitex.minutes', { n: total })}</span>}</legend>
      {rows.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('spitex.form.servicesEmpty')}</p>}
      <ul className="sx-svc-list">
        {rows.map((r, i) => (
          <li key={r.key} className="sx-svc-row">
            <Select label={t('spitex.form.klv')} hideLabel={i > 0} name="svc_klv" defaultValue={r.klv} wrapClassName="sx-svc-klv">
              {KLV_KEYS.map((k) => <option key={k} value={k}>{t('spitex.klvShort.' + k)}</option>)}
            </Select>
            <TextField label={t('spitex.form.serviceLabel')} hideLabel={i > 0} name="svc_label" defaultValue={r.label} maxLength={80} required wrapClassName="sx-svc-label" />
            <NumberField label={t('spitex.form.minutes')} hideLabel={i > 0} name="svc_min" defaultValue={r.minutes} min={1} max={240} step={1} unit={t('spitex.min')} required wrapClassName="sx-svc-min"
              onChange={(v) => setRows((x) => x.map((y) => (y.key === r.key ? { ...y, minutes: typeof v === 'number' ? v : 0 } : y)))} />
            <Tooltip content={t('spitex.form.removeService')}>
              <button type="button" className="icon-btn sx-svc-del" aria-label={t('spitex.form.removeServiceNamed', { label: r.label || String(i + 1) })} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                <IconClose size={16} />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>
      {rows.length < MAX_SERVICES && (
        <div className="row sx-svc-add">
          <Select aria-label={t('spitex.form.addPreset')} placeholder={t('spitex.form.addPreset')} value=""
            onChange={(e) => {
              const p = SERVICE_PRESETS.find((x) => x.key === e.value)
              if (p) add({ klv: p.klv, label: t('spitex.presets.' + p.key), minutes: p.minutes })
            }}>
            {KLV_KEYS.map((k) => (
              <optgroup key={k} label={t('spitex.klvShort.' + k)}>
                {SERVICE_PRESETS.filter((p) => p.klv === k).map((p) => <option key={p.key} value={p.key}>{t('spitex.presets.' + p.key)}</option>)}
              </optgroup>
            ))}
          </Select>
          <button type="button" className="btn sm" onClick={() => add({ klv: 'c', label: '', minutes: 15 })}>{t('spitex.form.addService')}</button>
        </div>
      )}
    </fieldset>
  )
}
