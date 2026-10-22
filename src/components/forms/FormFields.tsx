'use client'

import { useT } from '@/i18n/client'
import type { FieldError, FormField } from '@/lib/forms'
import { Checkbox, DateField, NumberField, RadioGroup, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'

export type RawValues = Record<string, string | boolean | string[]>

/**
 * Darstellung eines strukturierten Formulars (PRD §10.3). Wird im Verlauf (Dialog) und in der
 * Vorschau des Formular-Editors verwendet. Nur Klassen aus dem Design-System.
 */
export function FormFields({ fields, values, errors, onChange, idPrefix = 'ff', disabled }: {
  fields: FormField[]
  values: RawValues
  errors?: Record<string, FieldError>
  onChange: (key: string, value: string | boolean | string[]) => void
  idPrefix?: string
  disabled?: boolean
}) {
  const t = useT()
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`
        const err = errors?.[f.key]
        const errId = err ? id + '-err' : undefined
        const wide = f.type === 'textarea' || f.type === 'multiselect' || f.type === 'scale'
        const text = (
          <>
            {f.label}{f.unit && f.type !== 'number' ? ` (${f.unit})` : ''}{f.required ? <span aria-hidden="true"> *</span> : null}
            {f.required && <span className="sr-only"> ({t('common.required')})</span>}
          </>
        )
        const label = <span className="lbl">{text}</span>
        const errText = err ? t('forms.fieldErrors.' + err, { min: f.min ?? '', max: f.max ?? '' }) : undefined
        const errEl = err ? <span className="err" id={errId}>{errText}</span> : null
        const v = values[f.key]
        const str = typeof v === 'string' ? v : ''
        const common = { id, disabled, 'aria-invalid': err ? true : undefined, 'aria-describedby': errId, 'aria-required': f.required || undefined }

        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className="fld" style={{ justifyContent: 'flex-end' }}>
              <Checkbox {...common} checked={v === true} onChange={(e) => onChange(f.key, e.target.checked)} label={<>{f.label}{f.required ? ' *' : ''}</>} wrapStyle={{ minHeight: 34 }} />
              {errEl}
            </div>
          )
        }
        if (f.type === 'multiselect' || f.type === 'scale') {
          const sel = Array.isArray(v) ? v : []
          const opts = f.type === 'scale' ? range(f.min ?? 0, f.max ?? 10).map(String) : f.options ?? []
          return (
            <fieldset key={f.key} className="fld span-all" style={{ border: 0, padding: 0 }} aria-invalid={err ? true : undefined} aria-describedby={errId} disabled={disabled}>
              <legend style={{ padding: 0, marginBottom: 4 }}>{label}</legend>
              {f.type === 'scale' ? (
                <RadioGroup aria-label={f.label} variant="card" className="care-opts nrs" value={str} onChange={(o) => onChange(f.key, o)} disabled={disabled}
                  aria-invalid={err ? true : undefined} options={opts.map((o) => ({ value: o, label: <span className="mono">{o}</span> }))} />
              ) : (
                <div className="care-opts">
                  {opts.map((o) => (
                    <label key={o} className="opt">
                      <Checkbox checked={sel.includes(o)} onChange={(e) => onChange(f.key, e.target.checked ? [...sel, o] : sel.filter((x) => x !== o))} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
              )}
              {f.type === 'scale' && str !== '' && !f.required && (
                <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(f.key, '')}>{t('forms.clear')}</button>
              )}
              {errEl}
            </fieldset>
          )
        }
        // Einfache Felder: gemeinsamer Feld-Rahmen (Label, Einheit, Fehlermeldung am Feld)
        const fp = { id, label: text, error: errText, disabled, wrapClassName: wide ? 'span-all' : undefined, 'aria-required': f.required || undefined }
        if (f.type === 'textarea') return <Textarea key={f.key} {...fp} rows={3} value={str} maxLength={4000} onChange={(e) => onChange(f.key, e.target.value)} />
        if (f.type === 'select') {
          return (
            <Select key={f.key} {...fp} value={str} onChange={(e) => onChange(f.key, e.target.value)}>
              <option value="">–</option>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          )
        }
        if (f.type === 'date') return <DateField key={f.key} {...fp} value={str} onChange={(x) => onChange(f.key, x)} />
        if (f.type === 'time') return <TimeField key={f.key} {...fp} value={str} onChange={(x) => onChange(f.key, x)} />
        if (f.type === 'number') {
          const n = parseNum(str)
          return (
            <NumberField key={f.key} {...fp} unit={f.unit || undefined} value={n} onChange={(x) => onChange(f.key, x === '' ? '' : String(x))}
              placeholder={f.min != null && f.max != null ? `${f.min}–${f.max}` : undefined} />
          )
        }
        return <TextField key={f.key} {...fp} value={str} maxLength={f.type === 'text' ? 2000 : undefined} onChange={(e) => onChange(f.key, e.target.value)} />
      })}
    </div>
  )
}

const parseNum = (s: string): number | '' => {
  const n = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(n) ? '' : n
}
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

