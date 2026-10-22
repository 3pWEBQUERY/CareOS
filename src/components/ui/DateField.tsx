'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useT } from '@/i18n/client'
import {
  addDaysIso, addMonthsIso, clampIso, datePlaceholder, endOfWeekIso, formatDate, fullDateLabel, isIsoDate, monthGrid, monthLabel,
  outOfRange, parseDate, startOfWeekIso, todayIso, weekdayNames, ymd,
} from '@/lib/date-input'
import { IconCal, IconChevron, labelSourceId, portalTarget, SHEET_QUERY, trapTab, useAnchoredPopover, useFormBinding, useOutsideClose } from './field-popover'

export type FieldCommon = {
  /** Formularname; der Wert steht in einem versteckten Feld im bisherigen Format. */
  name?: string
  id?: string
  required?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  autoFocus?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  /** Markierung für Fehler-Fokus (`[data-field=…]`); Standard: name. */
  'data-field'?: string
}

export type DateFieldProps = FieldCommon & {
  /** YYYY-MM-DD */
  defaultValue?: string
  /** Kontrolliert: YYYY-MM-DD oder '' */
  value?: string
  onChange?: (value: string) => void
  min?: string
  max?: string
  /** Kurzwahl «Heute» im Kalender (Standard: an). */
  quick?: boolean
}

/**
 * Datumsfeld in der App-Sprache (PRD §50 «Date Picker»): Eingabe per Tastatur (TT.MM.JJJJ bzw. DD/MM/YYYY,
 * tolerant: 1.2.26, heute, +3) und Kalender (Montag zuerst, Pfeiltasten, Bild auf/ab, Pos1/Ende, Esc).
 * Ersetzt <input type="date">; das versteckte Feld `name` enthält YYYY-MM-DD.
 */
export function DateField(props: DateFieldProps) {
  const { name, id, defaultValue, value: controlled, onChange, required, min, max, disabled, className, style, title, autoFocus, quick = true } = props
  const t = useT()
  const locale = useLocale()
  const uid = useId()
  const inputId = id ?? uid + 'd'
  const popId = uid + 'p'
  const errId = uid + 'e'
  const isControlled = controlled !== undefined
  const initial = isIsoDate(defaultValue) ? defaultValue : ''
  const [inner, setInner] = useState(initial)
  const value = isControlled ? (isIsoDate(controlled) ? controlled : '') : inner
  const [text, setText] = useState(() => formatDate(value, locale))
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const committed = useRef(value)
  const placeholder = datePlaceholder(locale)
  const minD = isIsoDate(min) ? min : undefined
  const maxD = isIsoDate(max) ? max : undefined

  // Kontrollierter Wert von aussen geändert (oder Sprache gewechselt) → Anzeige nachführen
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setText(formatDate(value, locale))
      setErr(null)
    }
  }, [value, locale])

  const evaluate = (raw: string): { v: string | null; msg: string | null; empty?: boolean } => {
    const v = parseDate(raw, locale, todayIso())
    if (v === null) return { v: null, msg: t('common.dt.errDate', { format: placeholder }) }
    if (v === '') return { v: '', msg: required ? t('common.dt.errDateRequired') : null, empty: true }
    const r = outOfRange(v, minD, maxD)
    if (r) return { v, msg: t(r === 'min' ? 'common.dt.errMin' : 'common.dt.errMax', { value: formatDate(r === 'min' ? minD : maxD, locale) }) }
    return { v, msg: null }
  }

  const setValue = (v: string) => {
    if (hiddenRef.current) hiddenRef.current.value = v // sofort, falls direkt danach abgesendet wird
    if (v === committed.current) return
    committed.current = v
    if (!isControlled) setInner(v)
    onChange?.(v)
  }

  /** Text übernehmen. `submit` zeigt auch «Pflichtfeld»-Meldungen. */
  const commit = (raw: string, mode: 'blur' | 'submit') => {
    const r = evaluate(raw)
    if (r.v !== null) {
      setText(formatDate(r.v, locale))
      setValue(r.v)
    } else setValue('')
    setErr(mode === 'submit' || !r.empty ? r.msg : null)
    inputRef.current?.setCustomValidity(r.msg ?? '')
    return r.msg
  }

  const api = useRef({ submit: () => null as string | null, reset: () => {} })
  api.current.submit = () => commit(inputRef.current?.value ?? text, 'submit')
  api.current.reset = () => {
    setErr(null)
    if (isControlled) return
    committed.current = initial
    setInner(initial)
    setText(formatDate(initial, locale))
  }
  useFormBinding(inputRef, api)

  // Gültigkeit für native Formulare (ohne noValidate) laufend setzen
  const live = evaluate(text)
  useEffect(() => {
    inputRef.current?.setCustomValidity(live.msg ?? '')
  }, [live.msg])

  // Beschriftung ohne Kalender-Knopf/Fehlermeldung (siehe labelSourceId)
  useEffect(() => {
    if (props['aria-label'] || props['aria-labelledby']) return
    const src = labelSourceId(inputRef.current)
    if (src) inputRef.current!.setAttribute('aria-labelledby', src)
  }, [props])

  const close = (focusInput: boolean) => {
    setOpen(false)
    // Fokus zurück ins Feld; auf Mobile auf den Knopf, damit die Bildschirmtastatur nicht aufspringt
    if (focusInput) (window.matchMedia(SHEET_QUERY).matches ? btnRef.current : inputRef.current)?.focus()
  }
  const select = (iso: string) => {
    setText(formatDate(iso, locale))
    setValue(iso)
    setErr(null)
    close(true)
  }
  useOutsideClose(open, [boxRef, popRef], () => setOpen(false))

  const describedBy = [props['aria-describedby'], err ? errId : null].filter(Boolean).join(' ') || undefined
  const invalid = !!err || props['aria-invalid'] === true || props['aria-invalid'] === 'true'

  return (
    <div className={'dtf' + (className ? ' ' + className : '')} style={style}>
      <div className="dtf-box" ref={boxRef}>
        <input
          ref={inputRef}
          id={inputId}
          className="field mono dtf-in"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          aria-autocomplete="none"
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby']}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          data-field={props['data-field'] ?? name}
          title={title}
          autoFocus={autoFocus}
          placeholder={placeholder}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (err && !evaluate(e.target.value).msg) setErr(null)
          }}
          onBlur={(e) => {
            if (popRef.current?.contains(e.relatedTarget as Node)) return
            commit(e.target.value, 'blur')
            setOpen(false)
          }}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' && !e.shiftKey) || e.key === 'F4') {
              e.preventDefault()
              commit(e.currentTarget.value, 'blur')
              setOpen(true)
            } else if (e.key === 'Enter') commit(e.currentTarget.value, 'blur')
          }}
        />
        <button
          ref={btnRef}
          type="button"
          className="dtf-btn"
          tabIndex={-1}
          aria-label={t('common.dt.openCalendar')}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} // Fokus bleibt, wo er ist (Feld bzw. Kalender)
          onClick={() => {
            if (open) return close(true)
            commit(inputRef.current?.value ?? text, 'blur')
            setOpen(true)
          }}
        >
          <IconCal />
        </button>
      </div>
      {name && <input ref={hiddenRef} type="hidden" name={name} value={value} disabled={disabled} data-for={inputId} />}
      {err && <p className="err dtf-err" id={errId} role="alert">{err}</p>}
      {open && (
        <CalendarPopover
          popRef={popRef}
          anchor={boxRef}
          id={popId}
          value={value}
          min={minD}
          max={maxD}
          quick={quick}
          clearable={!required && !!value}
          onSelect={select}
          onClear={() => { setText(''); setValue(''); setErr(null); close(true) }}
          onClose={close}
        />
      )}
    </div>
  )
}

function CalendarPopover({ popRef, anchor, id, value, min, max, quick, clearable, onSelect, onClear, onClose }: {
  popRef: React.RefObject<HTMLDivElement | null>
  anchor: React.RefObject<HTMLDivElement | null>
  id: string
  value: string
  min?: string
  max?: string
  quick: boolean
  clearable: boolean
  onSelect: (iso: string) => void
  onClear: () => void
  onClose: (focusInput: boolean) => void
}) {
  const t = useT()
  const locale = useLocale()
  const today = todayIso()
  const [focus, setFocus] = useState(() => clampIso(value || today, min, max))
  const [y, m] = ymd(focus)
  const grid = monthGrid(y, m)
  const wd = weekdayNames(locale)
  const monthId = id + 'm'
  const { sheet, style } = useAnchoredPopover(true, anchor, popRef)
  const target = portalTarget(anchor.current)
  const gridFocus = useRef(true) // beim Öffnen in das Raster springen
  const disabled = (iso: string) => !!outOfRange(iso, min, max)
  const prevOk = !min || addMonthsIso(focus, -1).slice(0, 7) >= min.slice(0, 7)
  const nextOk = !max || addMonthsIso(focus, 1).slice(0, 7) <= max.slice(0, 7)
  const todayOk = !disabled(today)

  useLayoutEffect(() => {
    const cell = popRef.current?.querySelector<HTMLElement>(`[data-iso="${focus}"]`)
    if (cell && (gridFocus.current || popRef.current?.querySelector('[role="grid"]')?.contains(document.activeElement))) {
      cell.focus({ preventScroll: true })
      if (document.activeElement === cell) gridFocus.current = false // erst nach dem Positionieren sichtbar
    }
  }, [focus, popRef, style])

  const move = (iso: string) => setFocus(iso)
  const onGridKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => string> = {
      ArrowLeft: () => addDaysIso(focus, -1),
      ArrowRight: () => addDaysIso(focus, 1),
      ArrowUp: () => addDaysIso(focus, -7),
      ArrowDown: () => addDaysIso(focus, 7),
      PageUp: () => addMonthsIso(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonthsIso(focus, e.shiftKey ? 12 : 1),
      Home: () => startOfWeekIso(focus),
      End: () => endOfWeekIso(focus),
    }
    if (map[e.key]) {
      e.preventDefault()
      gridFocus.current = true // beim Monatswechsel wird die Zelle neu erzeugt
      move(map[e.key]())
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled(focus)) onSelect(focus)
    }
  }

  if (!target) return null
  return createPortal(
    <>
      {sheet && <div className="dtf-scrim" aria-hidden="true" />}
      <div
        ref={popRef}
        id={id}
        className={'dtf-pop dtf-cal' + (sheet ? ' is-sheet' : '')}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={t('common.dt.chooseDate')}
        onBlur={(e) => {
          // Fokus verlässt Kalender und Feld (Tab-Falle umgangen, Klick auf anderes Feld) → schliessen
          const to = e.relatedTarget as Node | null
          if (to && !popRef.current?.contains(to) && !anchor.current?.contains(to)) onClose(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault() // Esc schliesst nur den Kalender, nicht den umgebenden Dialog
            e.stopPropagation()
            onClose(true)
          } else trapTab(e)
        }}
      >
        <div className="dtf-cal-head">
          <button type="button" className="dtf-nav" aria-label={t('common.dt.prevMonth')} disabled={!prevOk} onClick={() => move(clampIso(addMonthsIso(focus, -1), min, max))}><IconChevron dir="left" /></button>
          <span className="dtf-month" id={monthId} aria-live="polite">{monthLabel(y, m, locale)}</span>
          <button type="button" className="dtf-nav" aria-label={t('common.dt.nextMonth')} disabled={!nextOk} onClick={() => move(clampIso(addMonthsIso(focus, 1), min, max))}><IconChevron dir="right" /></button>
        </div>
        <table className="dtf-grid" role="grid" aria-labelledby={monthId} onKeyDown={onGridKey}>
          <thead>
            <tr>{wd.map((w) => <th key={w.long} scope="col" abbr={w.long}>{w.short}</th>)}</tr>
          </thead>
          <tbody>
            {grid.map((week) => (
              <tr key={week[0]}>
                {week.map((iso) => {
                  const off = disabled(iso)
                  return (
                    <td
                      key={iso}
                      role="gridcell"
                      data-iso={iso}
                      tabIndex={iso === focus ? 0 : -1}
                      aria-selected={iso === value}
                      aria-current={iso === today ? 'date' : undefined}
                      aria-disabled={off || undefined}
                      aria-label={fullDateLabel(iso, locale)}
                      data-other={ymd(iso)[1] !== m || undefined}
                      onClick={() => { if (!off) onSelect(iso); else setFocus(iso) }}
                    >
                      {ymd(iso)[2]}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(quick || clearable || sheet) && (
          <div className="dtf-foot">
            {quick && <button type="button" className="btn sm" disabled={!todayOk} onClick={() => onSelect(today)}>{t('common.dt.today')}</button>}
            {clearable && <button type="button" className="btn sm ghost" onClick={onClear}>{t('common.dt.clear')}</button>}
            {sheet && <button type="button" className="btn sm ghost dtf-close" onClick={() => onClose(true)}>{t('common.close')}</button>}
          </div>
        )}
      </div>
    </>,
    target,
  )
}
