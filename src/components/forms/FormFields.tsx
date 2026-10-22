'use client'

import { useT } from '@/i18n/client'
import type { FieldError, FormField } from '@/lib/forms'

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
        const label = (
          <span className="lbl">
            {f.label}{f.unit ? ` (${f.unit})` : ''}{f.required ? <span aria-hidden="true"> *</span> : null}
            {f.required && <span className="sr-only"> ({t('common.required')})</span>}
          </span>
        )
        const errEl = err ? <span className="err" id={errId}>{t('forms.fieldErrors.' + err, { min: f.min ?? '', max: f.max ?? '' })}</span> : null
        const v = values[f.key]
        const str = typeof v === 'string' ? v : ''
        const common = { id, disabled, 'aria-invalid': err ? true : undefined, 'aria-describedby': errId, 'aria-required': f.required || undefined }

        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className="fld" style={{ justifyContent: 'flex-end' }}>
              <label className="check" style={{ minHeight: 34 }}>
                <input type="checkbox" {...common} checked={v === true} onChange={(e) => onChange(f.key, e.target.checked)} />
                <span>{f.label}{f.required ? ' *' : ''}</span>
              </label>
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
              <div className={'care-opts' + (f.type === 'scale' ? ' nrs' : '')}>
                {opts.map((o) => (
                  <label key={o} className="opt">
                    {f.type === 'scale' ? (
                      <input type="radio" name={id} value={o} checked={str === o} onChange={() => onChange(f.key, o)} />
                    ) : (
                      <input type="checkbox" checked={sel.includes(o)} onChange={(e) => onChange(f.key, e.target.checked ? [...sel, o] : sel.filter((x) => x !== o))} />
                    )}
                    <span className={f.type === 'scale' ? 'mono' : undefined}>{o}</span>
                  </label>
                ))}
              </div>
              {f.type === 'scale' && str !== '' && !f.required && (
                <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(f.key, '')}>{t('forms.clear')}</button>
              )}
              {errEl}
            </fieldset>
          )
        }
        return (
          <label key={f.key} className={'fld' + (wide ? ' span-all' : '')} htmlFor={id}>
            {label}
            {f.type === 'textarea' ? (
              <textarea className="field" rows={3} {...common} value={str} maxLength={4000} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <select className="field" {...common} value={str} onChange={(e) => onChange(f.key, e.target.value)}>
                <option value="">–</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className={'field' + (f.type === 'number' || f.type === 'time' || f.type === 'date' ? ' mono' : '')}
                {...common}
                type={f.type === 'number' ? 'text' : f.type}
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                value={str}
                maxLength={f.type === 'text' ? 2000 : undefined}
                placeholder={f.type === 'number' && f.min != null && f.max != null ? `${f.min}–${f.max}` : undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
            {errEl}
          </label>
        )
      })}
    </div>
  )
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

