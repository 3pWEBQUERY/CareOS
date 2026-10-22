'use client'

/**
 * Zahlenfeld (Vitalwerte, Dosen, Mengen, Einstellungen): Eingabe mit Komma oder Punkt, Anzeige mit dem
 * Dezimalzeichen der App-Sprache, Einheit als Suffix, min/max/step, Pfeiltasten ↑/↓ (mit Umschalt ×10),
 * Plausibilitätswarnung (`warn={{ lo, hi }}`, blockiert nicht). Ersetzt <input type="number">.
 * Das versteckte Feld `name` enthält den Wert mit Punkt («38.1»), damit Server Actions unverändert bleiben;
 * ungültige Eingaben verhindern das Absenden (Meldung am Feld).
 *
 *   <NumberField label="Temperatur" name="temp" unit="°C" min={30} max={45} step={0.1} warn={{ lo: 35.5, hi: 38 }} />
 */
import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { checkNumber, formatNumberInput, initialNumber, parseNumber, plausibility, stepNumber, toFormNumber } from '@/lib/number-input'
import { useFormBinding } from '../field-popover'
import { Field, cx, useFieldIds, type FieldProps } from './Field'
import { emitChange } from './emit'

export type NumberFieldProps = FieldProps & {
  name?: string
  id?: string
  defaultValue?: number | string | null
  /** Kontrolliert: Zahl oder '' (leer) */
  value?: number | '' | null
  onChange?: (value: number | '') => void
  onBlur?: () => void
  min?: number
  max?: number
  /** Raster für ↑/↓ und Prüfung; 1 = nur ganze Zahlen. Standard: 'any' */
  step?: number | 'any'
  /** Nachkommastellen in der Anzeige nach dem Verlassen des Felds */
  decimals?: number
  /** Plausibilitätsbereich: ausserhalb erscheint eine Warnung (kein Fehler). */
  warn?: { lo?: number; hi?: number }
  /** Eigener Warntext statt «Ungewöhnlich hoch/tief – bitte prüfen.» */
  warnText?: (dir: 'low' | 'high') => string
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  placeholder?: string
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  title?: string
  form?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  ref?: Ref<HTMLInputElement>
}

export function NumberField(props: NumberFieldProps) {
  const {
    name, defaultValue, value: controlled, onChange, onBlur, min, max, step = 'any', decimals, warn, warnText, required, disabled, readOnly,
    placeholder, className, style, autoFocus, title, form, ref,
  } = props
  const t = useT()
  const locale = useLocale()
  const isControlled = controlled !== undefined
  const init = initialNumber(defaultValue ?? null, locale)
  const [inner, setInner] = useState<number | ''>(init ?? '')
  const value: number | '' = isControlled ? (typeof controlled === 'number' && Number.isFinite(controlled) ? controlled : '') : inner
  const [text, setText] = useState(() => formatNumberInput(value === '' ? null : value, locale, decimals))
  const [err, setErr] = useState<string | null>(null)
  const committed = useRef<number | ''>(value)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const nf = (n: number) => formatNumberInput(n, locale)

  // Kontrollierter Wert von aussen geändert oder Sprache gewechselt → Anzeige nachführen
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setText(formatNumberInput(value === '' ? null : value, locale, decimals))
      setErr(null)
    }
  }, [value, locale, decimals])

  const message = (raw: string, submit: boolean): string | null => {
    const c = checkNumber(raw, locale, { min, max, step })
    if (c.kind === 'invalid') return t('common.field.errNumber')
    if (c.kind === 'min') return t('common.field.errMin', { value: nf(min!) })
    if (c.kind === 'max') return t('common.field.errMax', { value: nf(max!) })
    if (c.kind === 'step') return step === 1 ? t('common.field.errInteger') : t('common.field.errStep', { step: nf(step as number) })
    if (c.value === '' && required && submit) return t('common.field.errRequired')
    return null
  }

  const setValue = (v: number | '') => {
    if (hiddenRef.current) hiddenRef.current.value = v === '' ? '' : toFormNumber(v)
    if (v === committed.current) return
    committed.current = v
    if (!isControlled) setInner(v)
    onChange?.(v)
    emitChange(hiddenRef.current)
  }

  const commit = (raw: string, mode: 'blur' | 'submit') => {
    const p = parseNumber(raw, locale)
    const msg = message(raw, mode === 'submit')
    if (typeof p === 'number') {
      setValue(p)
      if (!msg) setText(formatNumberInput(p, locale, decimals))
    } else if (p === '') setValue('')
    else if (hiddenRef.current) hiddenRef.current.value = raw.trim() // ungültig: Rohtext (Server prüft wie bisher)
    setErr(msg)
    inputRef.current?.setCustomValidity(msg ?? '')
    return msg
  }

  const api = useRef({ submit: () => null as string | null, reset: () => {} })
  api.current.submit = () => commit(inputRef.current?.value ?? text, 'submit')
  api.current.reset = () => {
    setErr(null)
    inputRef.current?.setCustomValidity('')
    if (isControlled) return
    committed.current = init ?? ''
    setInner(init ?? '')
    setText(formatNumberInput(init, locale, decimals))
  }
  useFormBinding(inputRef, api)

  // Gültigkeit laufend (native Formulare ohne noValidate)
  const liveMsg = message(text, false)
  useEffect(() => { inputRef.current?.setCustomValidity(liveMsg ?? '') }, [liveMsg])

  const plaus = err ? null : plausibility(parseNumber(text, locale), warn)
  const warnMsg = plaus ? (warnText ? warnText(plaus) : t(plaus === 'high' ? 'common.field.warnHigh' : 'common.field.warnLow')) : null

  const f: FieldProps = { label: props.label, hideLabel: props.hideLabel, hint: props.hint, error: props.error ?? err, optional: props.optional, unit: props.unit, wrapClassName: props.wrapClassName, wrapStyle: props.wrapStyle }
  const ids = useFieldIds(f, { id: props.id, 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'] })
  const warnId = ids.id + '-w'
  const describedBy = cx(ids.describedBy, warnMsg && warnId)
  const intOnly = step === 1 || (typeof step === 'number' && Number.isInteger(step) && (min == null || Number.isInteger(min)))

  const input = (
    <input
      ref={(el) => {
        inputRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) (ref as { current: HTMLInputElement | null }).current = el
      }}
      id={ids.id}
      type="text"
      inputMode={intOnly && (min == null || min >= 0) ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      className={cx('field', 'mono', 'nf-in', className)}
      style={style}
      title={title}
      form={form}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      readOnly={readOnly}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={describedBy}
      aria-invalid={ids.invalid || undefined}
      aria-required={required || undefined}
      data-field={name}
      data-warn={plaus ?? undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const p = parseNumber(e.target.value, locale)
        const msg = message(e.target.value, false)
        if (p === '' || (typeof p === 'number' && !msg)) setValue(p)
        else if (hiddenRef.current) hiddenRef.current.value = e.target.value.trim()
        if (err && !msg) setErr(null)
      }}
      onBlur={(e) => {
        commit(e.target.value, 'blur')
        onBlur?.()
      }}
      onKeyDown={(e) => {
        if (readOnly || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
          if (e.key === 'Enter') commit(e.currentTarget.value, 'blur')
          return
        }
        e.preventDefault()
        const cur = parseNumber(e.currentTarget.value, locale)
        const s = typeof step === 'number' ? step : 1
        const n = stepNumber(cur === null ? '' : cur, e.key === 'ArrowUp' ? 1 : -1, { min, max, step: e.shiftKey ? s * 10 : s })
        setText(formatNumberInput(n, locale, decimals))
        setValue(n)
        setErr(null)
      }}
    />
  )
  const hidden = name ? <input ref={hiddenRef} type="hidden" name={name} form={form} value={value === '' ? '' : toFormNumber(value)} disabled={disabled} data-for={ids.id} /> : null
  const warnEl = warnMsg ? <p className="fld-warn" id={warnId}>{warnMsg}</p> : null
  if (!ids.wrapped && !warnEl) return <>{input}{hidden}</>
  return (
    <Field ids={ids} {...f} after={warnEl}>
      {input}
      {hidden}
    </Field>
  )
}
