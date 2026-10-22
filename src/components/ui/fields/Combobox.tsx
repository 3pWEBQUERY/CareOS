'use client'

/**
 * Durchsuchbare Auswahl (WAI-ARIA Combobox mit Listbox, `aria-activedescendant`) für lange Listen:
 * Personen, Mitarbeitende, Medikamente, Räume. Tippen filtert (ohne Akzente/Grossschreibung, mehrere Wörter),
 * ↑/↓ wählt vor, Enter übernimmt, Esc schliesst bzw. setzt zurück, Alt+↓ öffnet. Gruppen und Leerzustand.
 * Das versteckte Feld `name` enthält den Wert der gewählten Option (wie ein <select>). Mit `freeText`
 * wird ein nicht gelisteter Text übernommen (Ersatz für <input list=…>).
 *
 *   <Combobox label="Bewohner/in" name="residentId" options={residents.map((r) => ({ value: r.id, label: r.name, hint: r.room, group: r.unit }))} />
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n/client'
import { filterOptions, groupOptions, nextEnabled, normalize, type ComboOption } from '@/lib/combobox'
import { IconChevron, portalTarget, useFormBinding, useOutsideClose } from '../field-popover'
import { Field, cx, useFieldIds, type FieldProps } from './Field'
import { emitChange } from './emit'

export type { ComboOption }

export type ComboboxProps = FieldProps & {
  name?: string
  id?: string
  options: ComboOption[]
  defaultValue?: string | null
  /** Kontrolliert ('' = keine Auswahl) */
  value?: string | null
  onChange?: (value: string, option: ComboOption | null) => void
  /** Text im leeren Feld (Standard: «Suchen …») */
  placeholder?: string
  /** Text, wenn nichts passt (Standard: «Keine Treffer») */
  emptyText?: string
  /** Auswahl entfernen erlaubt (Standard: wenn nicht required) */
  clearable?: boolean
  /** Freier Text erlaubt (wird als Wert übernommen, wenn keine Option passt) */
  freeText?: boolean
  required?: boolean
  disabled?: boolean
  /** Höchstlänge des Texts (vor allem mit freeText) */
  maxLength?: number
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  form?: string
  title?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  ref?: Ref<HTMLInputElement>
}

export function Combobox(props: ComboboxProps) {
  const { name, options, defaultValue, value: controlled, onChange, placeholder, emptyText, freeText, required, disabled, maxLength, className, style, autoFocus, form, title, ref } = props
  const clearable = props.clearable ?? !required
  const t = useT()
  const isControlled = controlled !== undefined
  const initial = defaultValue ?? ''
  const [inner, setInner] = useState(initial)
  const value = isControlled ? controlled ?? '' : inner
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options])
  const selected = byValue.get(value) ?? null
  const labelOf = (v: string) => byValue.get(v)?.label ?? (freeText ? v : '')
  const [text, setText] = useState(() => labelOf(value))
  const [query, setQuery] = useState<string | null>(null) // null = nicht am Suchen → alle zeigen
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const committed = useRef(value)
  const uid = useId().replace(/[^\w-]/g, '')
  const listId = 'cb' + uid + 'l'
  const optId = (i: number) => 'cb' + uid + 'o' + i

  const f: FieldProps = { label: props.label, hideLabel: props.hideLabel, hint: props.hint, error: props.error ?? err, optional: props.optional, unit: props.unit, wrapClassName: props.wrapClassName, wrapStyle: props.wrapStyle }
  const ids = useFieldIds(f, { id: props.id, 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'] })

  // Gefilterte Liste in Anzeige-Reihenfolge (Gruppen zusammen); Navigation folgt derselben Reihenfolge
  const groups = useMemo(() => groupOptions(filterOptions(options, query ?? '')), [options, query])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // Wert von aussen (kontrolliert) oder Optionen geändert → Anzeige nachführen
  useEffect(() => {
    if (value !== committed.current || (query === null && text !== labelOf(value))) {
      committed.current = value
      if (query === null) setText(labelOf(value))
    }
  }, [value, byValue])

  const setValue = (v: string) => {
    if (hiddenRef.current) hiddenRef.current.value = v
    if (v === committed.current) return
    committed.current = v
    if (!isControlled) setInner(v)
    onChange?.(v, byValue.get(v) ?? null)
    emitChange(hiddenRef.current)
  }

  const choose = (o: ComboOption | null) => {
    setValue(o?.value ?? '')
    setText(o?.label ?? '')
    setQuery(null)
    setOpen(false)
    setActive(-1)
    setErr(null)
    inputRef.current?.setCustomValidity('')
  }

  /** Text übernehmen (Blur/Tab/Absenden): exakter Treffer → Auswahl; leer → leeren; sonst zurück bzw. freier Text */
  const settle = (submit = false): string | null => {
    const raw = (inputRef.current?.value ?? text).trim()
    let msg: string | null = null
    if (query !== null) {
      if (!raw) {
        if (clearable || submit) setValue('')
        setText(clearable ? '' : labelOf(committed.current))
      } else {
        const exact = options.find((o) => !o.disabled && normalize(o.label) === normalize(raw))
        if (exact) { setValue(exact.value); setText(exact.label) }
        else if (freeText) { setValue(raw); setText(raw) }
        else setText(labelOf(committed.current))
      }
      setQuery(null)
    }
    const v = hiddenRef.current?.value ?? committed.current
    if (submit && required && !v) msg = t('common.field.errChoose')
    setErr(msg)
    inputRef.current?.setCustomValidity(msg ?? '')
    return msg
  }

  const api = useRef({ submit: () => null as string | null, reset: () => {} })
  api.current.submit = () => settle(true)
  api.current.reset = () => {
    setErr(null)
    inputRef.current?.setCustomValidity('')
    setQuery(null)
    setOpen(false)
    if (isControlled) return
    committed.current = initial
    setInner(initial)
    setText(labelOf(initial))
  }
  useFormBinding(inputRef, api)
  useEffect(() => { inputRef.current?.setCustomValidity(required && !value && !text ? t('common.field.errChoose') : '') }, [required, value, text, t])

  useOutsideClose(open, [boxRef, popRef], () => { setOpen(false); settle() })

  const openList = (at?: number) => {
    if (disabled) return
    setOpen(true)
    const sel = flat.findIndex((o) => o.value === committed.current)
    setActive(at ?? (sel >= 0 ? sel : nextEnabled(flat, -1, 1)))
  }

  // Aktive Option sichtbar halten
  useLayoutEffect(() => {
    if (!open || active < 0) return
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const n = flat.length
  const invalid = ids.invalid
  return (
    <ComboWrap ids={ids} f={f}>
      <div className={cx('cb', className)} style={style} ref={boxRef}>
        <input
          ref={(el) => {
            inputRef.current = el
            if (typeof ref === 'function') ref(el)
            else if (ref) (ref as { current: HTMLInputElement | null }).current = el
          }}
          id={ids.id}
          className="field cb-in"
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open && !(freeText && n === 0)}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
          aria-label={props['aria-label']}
          aria-labelledby={props['aria-labelledby']}
          aria-describedby={ids.describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          data-field={name}
          title={title ?? (selected?.hint ? `${selected.label} · ${selected.hint}` : undefined)}
          placeholder={placeholder ?? t('common.field.searchPh')}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          form={form}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setQuery(e.target.value)
            if (freeText) setValue(e.target.value) // freier Text gilt sofort (z. B. ohne Blur auf einen Knopf in Safari)
            setOpen(true)
            const list = groupOptions(filterOptions(options, e.target.value)).flatMap((g) => g.items)
            // Mit freiem Text übernimmt Enter den getippten Text, sonst den ersten Treffer
            setActive(freeText ? -1 : nextEnabled(list, -1, 1))
            if (err) setErr(null)
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            if (popRef.current?.contains(e.relatedTarget as Node)) return
            setOpen(false)
            settle()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open) return openList(e.key === 'ArrowUp' ? nextEnabled(flat, 0, -1) : undefined)
              if (e.altKey) return
              setActive((a) => nextEnabled(flat, a, e.key === 'ArrowDown' ? 1 : -1))
            } else if (e.key === 'Enter') {
              if (open && active >= 0 && flat[active] && !flat[active].disabled) {
                e.preventDefault()
                choose(flat[active])
              } else if (open) {
                e.preventDefault()
                setOpen(false)
                settle()
              }
            } else if (e.key === 'Escape') {
              if (open || query !== null) {
                e.preventDefault()
                e.stopPropagation() // umgebenden Dialog nicht schliessen
                setOpen(false)
                setQuery(null)
                setText(labelOf(committed.current))
              }
            } else if ((e.key === 'Home' || e.key === 'End') && open && e.ctrlKey) {
              e.preventDefault()
              setActive(e.key === 'Home' ? nextEnabled(flat, -1, 1) : nextEnabled(flat, 0, -1))
            } else if (e.key === 'Tab' && open) {
              setOpen(false)
              settle()
            }
          }}
          onClick={() => { if (!open) openList() }}
        />
        {clearable && value && !disabled ? (
          <button type="button" className="cb-btn cb-clear" tabIndex={-1} aria-label={t('common.field.clear')} onMouseDown={(e) => e.preventDefault()}
            onClick={() => { choose(null); inputRef.current?.focus() }}>
            <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        ) : null}
        <button type="button" className="cb-btn cb-toggle" tabIndex={-1} aria-label={t('common.field.openList')} aria-expanded={open} aria-controls={listId} disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (open) { setOpen(false); settle() } else { openList(); inputRef.current?.focus() } }}>
          <span className="cb-chev"><IconChevron dir="right" /></span>
        </button>
        {name && <input ref={hiddenRef} type="hidden" name={name} form={form} value={value} disabled={disabled} data-for={ids.id} />}
        <span className="sr-only" aria-live="polite">{open && query !== null ? (n ? t('common.field.results', { n }) : freeText ? '' : emptyText ?? t('common.field.noResults')) : ''}</span>
      </div>
      {/* Mit freiem Text ist «keine Treffer» kein Fehler: Liste dann ausblenden */}
      <ListPopover open={open && !(freeText && n === 0)} anchor={boxRef} popRef={popRef} id={listId} labelledBy={props['aria-labelledby'] ?? (props.label != null ? ids.labelId : undefined)} label={props['aria-label']}>
        {n === 0 ? (
          <div className="cb-empty" role="presentation">{emptyText ?? t('common.field.noResults')}</div>
        ) : groups.map((g, gi) => {
          const start = groups.slice(0, gi).reduce((s, x) => s + x.items.length, 0)
          const items = g.items.map((o, k) => {
            const i = start + k
            return (
              <div
                key={o.value}
                id={optId(i)}
                role="option"
                className="cb-opt"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => { if (active !== i && !o.disabled) setActive(i) }}
                onClick={() => { if (!o.disabled) choose(o) }}
              >
                <span className="cb-opt-l">{o.label}</span>
                {o.hint && <span className="cb-opt-h">{o.hint}</span>}
              </div>
            )
          })
          return g.group ? (
            <div key={g.group} role="group" aria-labelledby={'cb' + uid + 'g' + gi}>
              <div className="cb-group" id={'cb' + uid + 'g' + gi} role="presentation">{g.group}</div>
              {items}
            </div>
          ) : <div key="_" role="presentation">{items}</div>
        })}
      </ListPopover>
    </ComboWrap>
  )
}

function ComboWrap({ ids, f, children }: { ids: ReturnType<typeof useFieldIds>; f: FieldProps; children: React.ReactNode }) {
  return ids.wrapped ? <Field ids={ids} {...f} unit={undefined}>{children}</Field> : <>{children}</>
}

/** Listbox im Portal (im offenen <dialog>, sonst body), unter bzw. über dem Feld in Feldbreite. */
function ListPopover({ open, anchor, popRef, id, labelledBy, label, children }: {
  open: boolean
  anchor: React.RefObject<HTMLDivElement | null>
  popRef: React.RefObject<HTMLDivElement | null>
  id: string
  labelledBy?: string
  label?: string
  children: React.ReactNode
}) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useLayoutEffect(() => {
    if (!open) return
    const place = (e?: Event) => {
      if (e && e.type === 'scroll' && popRef.current && e.target instanceof Node && popRef.current.contains(e.target)) return
      const a = anchor.current?.getBoundingClientRect()
      if (!a) return
      const m = 8
      const vh = window.visualViewport?.height ?? window.innerHeight
      const vw = document.documentElement.clientWidth
      const below = vh - a.bottom - m
      const above = a.top - m
      const up = below < 200 && above > below
      const maxH = Math.max(120, Math.min(352, (up ? above : below) - 4))
      const width = Math.min(Math.max(a.width, 240), vw - 2 * m)
      const left = Math.max(m, Math.min(a.left, vw - width - m))
      setStyle(up ? { left, width, bottom: window.innerHeight - a.top + 4, maxHeight: maxH } : { left, width, top: a.bottom + 4, maxHeight: maxH })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open, anchor, popRef])
  // Listbox immer im DOM (aria-controls zeigt auf ein vorhandenes Element), geschlossen verborgen
  const target = mounted ? portalTarget(anchor.current) : null
  if (!target) return null
  return createPortal(
    <div ref={popRef} id={id} role="listbox" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className="cb-pop" style={style} hidden={!open} tabIndex={-1}>
      {open ? children : null}
    </div>,
    target,
  )
}
