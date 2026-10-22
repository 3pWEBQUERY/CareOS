'use client'

/**
 * Einfachauswahl als WAI-ARIA Radio Group (Buttons role="radio", Pfeiltasten über radio.ts, ein Tab-Stopp).
 * `variant="list"` (Standard): Optionen mit Kreis untereinander/nebeneinander; `SegmentedControl`: Segmente
 * (.seg) für wenige, kurze Optionen. Mit `name` steht der Wert in einem versteckten Feld (Formular, Reset).
 *
 *   <RadioGroup label="Zugang" name="mode" defaultValue="invite" options={[{ value: 'invite', label: 'Einladung' }, …]} />
 *   <SegmentedControl aria-label="Darstellung" value={theme} onChange={setTheme} options={…} />
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { onRadioKeys } from '../radio'
import { cx } from './Field'
import { OptionalMark } from './marks'

export type RadioOption = { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean; title?: string }

export type RadioGroupProps = {
  name?: string
  options: RadioOption[]
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  label?: ReactNode
  hideLabel?: boolean
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
  required?: boolean
  disabled?: boolean
  /** nebeneinander (Standard bei «seg») */
  inline?: boolean
  variant?: 'list' | 'seg'
  className?: string
  style?: CSSProperties
  wrapClassName?: string
  wrapStyle?: CSSProperties
  form?: string
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

export function RadioGroup(props: RadioGroupProps) {
  const { name, options, defaultValue, value: controlled, onChange, label, hideLabel, hint, error, optional, required, disabled, inline, variant = 'list', className, style, wrapClassName, wrapStyle, form } = props
  const uid = useId().replace(/[^\w-]/g, '')
  const id = props.id ?? 'rg' + uid
  const isControlled = controlled !== undefined
  const [inner, setInner] = useState(defaultValue ?? '')
  const value = isControlled ? controlled ?? '' : inner
  const groupRef = useRef<HTMLDivElement>(null)
  const hasErr = error != null && error !== false && error !== ''
  const invalid = hasErr || props['aria-invalid'] === true || props['aria-invalid'] === 'true'

  // Formular-Reset → Startwert
  useEffect(() => {
    const f = groupRef.current?.closest('form')
    if (!f || isControlled) return
    const onReset = () => setInner(defaultValue ?? '')
    f.addEventListener('reset', onReset)
    return () => f.removeEventListener('reset', onReset)
  }, [defaultValue, isControlled])

  const select = (v: string) => {
    if (!isControlled) setInner(v)
    if (v !== value) onChange?.(v)
  }
  // Tab-Stopp: gewählte Option, sonst die erste aktivierbare
  const tabValue = options.some((o) => o.value === value && !o.disabled) ? value : options.find((o) => !o.disabled)?.value
  const seg = variant === 'seg'

  const group = (
    <div
      ref={groupRef}
      id={id}
      role="radiogroup"
      className={cx(seg ? 'seg rg-seg' : 'rg', !seg && inline && 'rg-inline', className)}
      style={style}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby'] ?? (label != null ? id + '-l' : undefined)}
      aria-describedby={cx(props['aria-describedby'], hint != null && id + '-h', hasErr && id + '-e')}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      aria-disabled={disabled || undefined}
      data-field={name}
      onKeyDown={onRadioKeys}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={seg ? undefined : 'rg-opt'}
            tabIndex={o.value === tabValue ? 0 : -1}
            disabled={disabled || o.disabled}
            title={o.title}
            onClick={() => select(o.value)}
          >
            {!seg && <span className="rg-dot" aria-hidden="true" />}
            {seg ? o.label : (
              <span className="rg-text">
                <span>{o.label}</span>
                {o.hint != null && <span className="rg-hint">{o.hint}</span>}
              </span>
            )}
          </button>
        )
      })}
      {name && <input type="hidden" name={name} value={value} form={form} disabled={disabled} data-for={id} />}
    </div>
  )
  if (label == null && hint == null && !hasErr) return group
  return (
    <div className={cx('fld', wrapClassName)} style={wrapStyle} data-invalid={hasErr || undefined}>
      {label != null && <span className={cx('lbl', hideLabel && 'sr-only')} id={id + '-l'}>{label}{optional && <OptionalMark />}</span>}
      {group}
      {hint != null && <p className="hint fld-hint" id={id + '-h'}>{hint}</p>}
      {hasErr && <p className="err fld-err" id={id + '-e'} role="alert">{error}</p>}
      <span className="fld-slot" data-err-slot="" />
    </div>
  )
}

/** Segmentierte Einfachauswahl (wenige, kurze Optionen) – RadioGroup im Stil .seg. */
export function SegmentedControl(props: Omit<RadioGroupProps, 'variant' | 'inline'>) {
  return <RadioGroup {...props} variant="seg" />
}
