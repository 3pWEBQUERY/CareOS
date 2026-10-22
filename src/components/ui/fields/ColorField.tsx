'use client'

/**
 * Farbfeld: Farbwähler und Hex-Eingabe (#RRGGBB) nebeneinander; das Textfeld trägt `name`.
 *
 *   <ColorField label="Markenfarbe" name="brandColor" defaultValue="#0B5F74" />
 */
import { useState, type ReactNode } from 'react'
import { useT } from '@/i18n/client'
import { Field, useFieldIds, type FieldProps } from './Field'

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v)

export function ColorField(props: FieldProps & {
  name: string
  id?: string
  defaultValue?: string
  value?: string
  onChange?: (v: string) => void
  /** Farbe des Wählers, solange das Textfeld leer/ungültig ist */
  fallback?: string
  placeholder?: string
  disabled?: boolean
  children?: ReactNode
}) {
  const { name, defaultValue = '', value: controlled, onChange, fallback = '#0B5F74', placeholder, disabled } = props
  const t = useT()
  const [inner, setInner] = useState(defaultValue)
  const v = controlled ?? inner
  const set = (x: string) => { if (controlled === undefined) setInner(x); onChange?.(x) }
  const valid = isHexColor(v)
  const err = v !== '' && !valid ? t('common.field.errColor') : null
  const f: FieldProps = { label: props.label, hideLabel: props.hideLabel, hint: props.hint, error: props.error ?? err, optional: props.optional, wrapClassName: props.wrapClassName, wrapStyle: props.wrapStyle }
  const ids = useFieldIds(f, { id: props.id })
  return (
    <Field ids={ids} {...f}>
      <div className="clr">
        <input type="color" className="clr-pick" aria-label={t('common.field.colorPick')} value={valid ? v.toLowerCase() : fallback.toLowerCase()} disabled={disabled}
          onChange={(e) => set(e.target.value.toUpperCase())} />
        <input id={ids.id} className="field mono clr-in" name={name} value={v} placeholder={placeholder ?? fallback} maxLength={7} disabled={disabled}
          autoComplete="off" spellCheck={false} aria-describedby={ids.describedBy} aria-invalid={ids.invalid || undefined}
          onChange={(e) => set(e.target.value.trim())} />
        {props.children}
      </div>
    </Field>
  )
}
