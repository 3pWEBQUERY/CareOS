'use client'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n/client'
import { isTime, nearestIndex, nowTime, outOfRange, parseTime, timeOptions, TIME_PLACEHOLDER } from '@/lib/date-input'
import { IconCheck } from '@/components/icons'
import type { FieldCommon } from './DateField'
import { IconClock, labelSourceId, portalTarget, SHEET_QUERY, useAnchoredPopover, useFormBinding, useOutsideClose } from './field-popover'

export type TimeFieldProps = FieldCommon & {
  /** HH:MM */
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  min?: string
  max?: string
  /** Schritt in Sekunden wie beim nativen Feld; die Auswahlliste nutzt ihn (mind. 5 Min.), sonst 15 Min. */
  step?: number
  /** Kurzwahl «Jetzt» in der Liste (Standard: an). */
  quick?: boolean
  /** Wird zusätzlich aufgerufen, wenn «Jetzt» gewählt wurde (DateTimeField setzt dann das Datum). */
  onNow?: (value: string) => void
}

/**
 * Uhrzeitfeld, 24 h (PRD §50 «Time Picker»): Eingabe "7:30", "730", "17h30", "jetzt" und Auswahlliste
 * im Combobox-Muster (Fokus bleibt im Feld, Pfeiltasten, Enter, Esc). Ersetzt <input type="time">.
 */
export function TimeField(props: TimeFieldProps) {
  const { name, id, defaultValue, value: controlled, onChange, required, min, max, step, disabled, className, style, title, autoFocus, quick = true, onNow } = props
  const t = useT()
  const uid = useId()
  const inputId = id ?? uid + 't'
  const listId = uid + 'l'
  const errId = uid + 'e'
  const isControlled = controlled !== undefined
  const initial = isTime(defaultValue) ? defaultValue : ''
  const [inner, setInner] = useState(initial)
  const value = isControlled ? (isTime(controlled) ? controlled : '') : inner
  const [text, setText] = useState(value)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [now, setNow] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const committed = useRef(value)
  const minT = isTime(min) ? min : undefined
  const maxT = isTime(max) ? max : undefined
  const stepMin = step && step >= 60 ? Math.max(5, step / 60) : 15

  const base = useMemo(() => timeOptions(stepMin, minT, maxT), [stepMin, minT, maxT])
  const showNow = quick && !!now && !outOfRange(now, minT, maxT)
  // Optionen: [Jetzt, …Raster]; Index 0 = Jetzt, wenn vorhanden
  const opts = showNow ? [now, ...base] : base

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setText(value)
      setErr(null)
    }
  }, [value])

  const evaluate = (raw: string): { v: string | null; msg: string | null; empty?: boolean } => {
    const v = parseTime(raw)
    if (v === null) return { v: null, msg: t('common.dt.errTime') }
    if (v === '') return { v: '', msg: required ? t('common.dt.errTimeRequired') : null, empty: true }
    const r = outOfRange(v, minT, maxT)
    if (r) return { v, msg: t(r === 'min' ? 'common.dt.errMin' : 'common.dt.errMax', { value: r === 'min' ? minT : maxT }) }
    return { v, msg: null }
  }
  const setValue = (v: string) => {
    if (hiddenRef.current) hiddenRef.current.value = v
    if (v === committed.current) return
    committed.current = v
    if (!isControlled) setInner(v)
    onChange?.(v)
  }
  const commit = (raw: string, mode: 'blur' | 'submit') => {
    const r = evaluate(raw)
    if (r.v !== null) {
      setText(r.v)
      setValue(r.v)
    } else setValue('')
    setErr(mode === 'submit' || !r.empty ? r.msg : null)
    inputRef.current?.setCustomValidity(r.msg ?? '')
    return r.msg
  }

  const api = useRef({ submit: () => null as string | null, reset: () => {} })
  api.current.submit = () => { setOpen(false); return commit(inputRef.current?.value ?? text, 'submit') }
  api.current.reset = () => {
    setErr(null)
    if (isControlled) return
    committed.current = initial
    setInner(initial)
    setText(initial)
  }
  useFormBinding(inputRef, api)

  const live = evaluate(text)
  useEffect(() => {
    inputRef.current?.setCustomValidity(live.msg ?? '')
  }, [live.msg])

  useEffect(() => {
    if (props['aria-label'] || props['aria-labelledby']) return
    const el = inputRef.current!
    const src = labelSourceId(el)
    if (src) el.setAttribute('aria-labelledby', src)
    else if (!el.labels?.length) el.setAttribute('aria-label', t('common.dt.time'))
  }, [props, t])

  const openList = () => {
    const n = nowTime()
    setNow(n)
    const cur = parseTime(inputRef.current?.value ?? text) || value
    const list = quick && !outOfRange(n, minT, maxT) ? [n, ...base] : base
    // Startpunkt: aktueller Wert im Raster, sonst die nächste Zeit ab jetzt
    const off = list.length - base.length
    setActive(off + Math.max(0, nearestIndex(base, cur || n)))
    setOpen(true)
  }
  const close = () => { setOpen(false); setActive(-1) }
  /** Fokus zurück; auf Mobile auf den Knopf, damit die Bildschirmtastatur nicht aufspringt. */
  const refocus = () => (window.matchMedia(SHEET_QUERY).matches ? btnRef.current : inputRef.current)?.focus()
  const choose = (i: number) => {
    const v = opts[i]
    if (!v) return
    setText(v)
    setValue(v)
    setErr(null)
    inputRef.current?.setCustomValidity('')
    if (showNow && i === 0) onNow?.(v)
    close()
    refocus()
  }
  useOutsideClose(open, [boxRef, popRef], close)

  // Aktive Option sichtbar halten (beim Öffnen mittig, danach nur so weit wie nötig)
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (!open) { scrolled.current = false; return }
    if (active < 0) return
    const list = popRef.current?.querySelector<HTMLElement>('.dtf-list')
    const el = list?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!list || !el) return
    if (!scrolled.current) {
      list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2
      scrolled.current = true
    } else if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight
  }, [open, active])

  const describedBy = [props['aria-describedby'], err ? errId : null].filter(Boolean).join(' ') || undefined
  const invalid = !!err || props['aria-invalid'] === true || props['aria-invalid'] === 'true'
  const optId = (i: number) => `${listId}-${i}`

  return (
    <div className={'dtf dtf-time' + (className ? ' ' + className : '')} style={style}>
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
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
          aria-autocomplete="none"
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby']}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          data-field={props['data-field'] ?? name}
          title={title}
          autoFocus={autoFocus}
          placeholder={TIME_PLACEHOLDER}
          maxLength={8}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (err && !evaluate(e.target.value).msg) setErr(null)
            if (open) {
              const p = parseTime(e.target.value)
              if (p) setActive(opts.length - base.length + Math.max(0, nearestIndex(base, p)))
            }
          }}
          onBlur={(e) => {
            if (popRef.current?.contains(e.relatedTarget as Node)) return
            commit(e.target.value, 'blur')
            close()
          }}
          onKeyDown={(e) => {
            const last = opts.length - 1
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open || e.altKey) return open && e.altKey && e.key === 'ArrowUp' ? close() : openList()
              setActive((a) => Math.max(0, Math.min(last, a + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (open && (e.key === 'PageDown' || e.key === 'PageUp')) {
              e.preventDefault()
              const jump = Math.max(1, Math.round(60 / stepMin))
              setActive((a) => Math.max(0, Math.min(last, a + (e.key === 'PageDown' ? jump : -jump))))
            } else if (e.key === 'F4') {
              e.preventDefault()
              if (open) close()
              else openList()
            } else if (e.key === 'Enter') {
              if (open && active >= 0) {
                e.preventDefault() // Auswahl, kein Absenden
                choose(active)
              } else commit(e.currentTarget.value, 'blur')
            } else if (e.key === 'Escape' && open) {
              e.preventDefault()
              e.stopPropagation()
              close()
            } else if (e.key === 'Tab' && open) {
              close()
            }
          }}
        />
        <button
          ref={btnRef}
          type="button"
          className="dtf-btn"
          tabIndex={-1}
          aria-label={t('common.dt.openTimes')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) return close()
            if (window.matchMedia(SHEET_QUERY).matches) inputRef.current?.blur() // Blatt statt Tastatur
            else inputRef.current?.focus()
            openList()
          }}
        >
          <IconClock />
        </button>
      </div>
      {name && <input ref={hiddenRef} type="hidden" name={name} value={value} disabled={disabled} data-for={inputId} />}
      {err && <p className="err dtf-err" id={errId} role="alert">{err}</p>}
      {open && (
        <TimePopover popRef={popRef} anchor={boxRef}>
          {(sheet) => (
            <>
              {sheet && <div className="dtf-sheet-title">{t('common.dt.chooseTime')}</div>}
              <ul className="dtf-list" id={listId} role="listbox" aria-label={t('common.dt.chooseTime')}>
                {opts.map((o, i) => {
                  const isNow = showNow && i === 0
                  const sel = !isNow && o === value
                  return (
                    <li
                      key={isNow ? 'now' : o}
                      id={optId(i)}
                      data-i={i}
                      role="option"
                      aria-selected={sel}
                      className={'mono' + (i === active ? ' is-active' : '') + (isNow ? ' is-now' : '')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(i)}
                    >
                      {isNow ? <><span className="dtf-now">{t('common.dt.now')}</span>{o}</> : o}
                      {sel && <IconCheck />}
                    </li>
                  )
                })}
              </ul>
              {sheet && (
                <div className="dtf-foot">
                  <button type="button" className="btn sm ghost dtf-close" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); refocus() }}>{t('common.close')}</button>
                </div>
              )}
            </>
          )}
        </TimePopover>
      )}
    </div>
  )
}

function TimePopover({ popRef, anchor, children }: { popRef: React.RefObject<HTMLDivElement | null>; anchor: React.RefObject<HTMLDivElement | null>; children: (sheet: boolean) => React.ReactNode }) {
  const { sheet, style } = useAnchoredPopover(true, anchor, popRef, true)
  const target = portalTarget(anchor.current)
  if (!target) return null
  return createPortal(
    <>
      {sheet && <div className="dtf-scrim" aria-hidden="true" />}
      <div ref={popRef} className={'dtf-pop dtf-times' + (sheet ? ' is-sheet' : '')} style={style}>
        {children(sheet)}
      </div>
    </>,
    target,
  )
}
