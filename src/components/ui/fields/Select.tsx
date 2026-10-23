'use client'

/**
 * Auswahlliste im CareOS-Design (WAI-ARIA «Select-only Combobox»): Knopf mit `role="combobox"` und Listbox im
 * Popover (Desktop unter/über dem Feld, Mobile als Blatt, im offenen <dialog> dort gerendert). Ersetzt das
 * native <select>, API bleibt gleich: Kinder als `<option value>Text</option>` und `<optgroup label>`, `name`
 * schreibt den Wert in ein verstecktes Feld (Server Actions/FormData unverändert), `value`/`defaultValue`,
 * `onChange(e)` mit `e.target.value`. Das versteckte Feld löst ein natives `change` aus (Filter-Formulare).
 * Tastatur: ↑↓, Pos1/Ende, Bild auf/ab, Enter/Leertaste, Esc, Tab übernimmt, Tippen springt zum Treffer.
 * Für lange, durchsuchbare Listen (Personen, Mitarbeitende, Medikamente, Räume) `Combobox` verwenden.
 *
 *   <Select label="Rolle" name="roleId" required placeholder="Bitte wählen">{roles.map(…<option/>)}</Select>
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEventHandler, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n/client'
import { firstEnabled, groupRuns, indexOfValue, lastEnabled, moveActive, optionsFromChildren, resolveValue, selectKeyAction, typeahead, type SelectOpt } from '@/lib/select-options'
import { IconChevron, portalTarget, useAnchoredPopover, useFormBinding, useOutsideClose } from '../field-popover'
import { Field, cx, useFieldIds, type FieldProps } from './Field'
import { emitChange } from './emit'

export type { SelectOpt }

/** Ereignis-ähnliches Objekt für `onChange` (kompatibel mit `e.target.value` / `e.currentTarget.value`). */
export type SelectChangeEvent = {
  target: { value: string; name: string }
  currentTarget: { value: string; name: string }
  value: string
  option: SelectOpt | null
}

export type SelectProps = FieldProps & {
  name?: string
  id?: string
  /** Kontrolliert */
  value?: string | number | null
  defaultValue?: string | number | null
  onChange?: (e: SelectChangeEvent) => void
  /** Leere erste Option (value=""), z. B. «Bitte wählen» oder «Alle». */
  placeholder?: string
  /** Ohne .field-Rahmen (Stil kommt vom Kontext, z. B. Verlaufseintrag, Topbar) */
  plain?: boolean
  /** Wird gerade übernommen (z. B. Bereichswechsel): Spinner statt Pfeil, Liste gesperrt, Fokus bleibt. */
  loading?: boolean
  required?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  autoFocus?: boolean
  form?: string
  title?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-required'?: boolean | 'true' | 'false'
  onFocus?: FocusEventHandler<HTMLButtonElement>
  onBlur?: FocusEventHandler<HTMLButtonElement>
  ref?: Ref<HTMLButtonElement>
}

const str = (v: string | number | null | undefined) => (v == null ? undefined : String(v))
const TYPE_MS = 600

export function Select(props: SelectProps) {
  const { name, placeholder, plain, loading, required, disabled, className, style, autoFocus, form, title, children, onChange, ref } = props
  const t = useT()
  const opts = optionsFromChildren(children, placeholder)
  const isControlled = props.value !== undefined
  const [inner, setInner] = useState<string | undefined>(() => str(props.defaultValue))
  const value = resolveValue(opts, isControlled ? str(props.value) : inner)
  const selIndex = indexOfValue(opts, value)
  const selected = opts[selIndex] ?? null
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [err, setErr] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const typed = useRef({ buf: '', at: 0 })
  const fromLabel = useRef(false)
  const uid = useId().replace(/[^\w-]/g, '')
  const listId = 'sl' + uid + 'l'
  const optId = (i: number) => 'sl' + uid + 'o' + i

  // Rahmen nur von Props abhängig (eine Prüfmeldung darf das Steuerelement nicht neu einhängen → Fokus bleibt)
  const propErr = props.error != null && props.error !== false && props.error !== ''
  const structWrapped = props.label != null || props.hint != null || propErr || props.unit != null
  const f: FieldProps = { label: props.label, hideLabel: props.hideLabel, hint: props.hint, error: propErr ? props.error : err, optional: props.optional, unit: props.unit, wrapClassName: props.wrapClassName, wrapStyle: props.wrapStyle }
  const ids = useFieldIds(f, { id: props.id, 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'] })
  const busy = !!loading

  const close = () => {
    setOpen(false)
    setActive(-1)
    typed.current.buf = ''
  }
  const openList = (at?: number) => {
    if (disabled || busy) return
    setOpen(true)
    setActive(at != null && at >= 0 ? at : selIndex >= 0 && !opts[selIndex].disabled ? selIndex : firstEnabled(opts))
  }
  const choose = (i: number) => {
    const o = opts[i]
    if (!o || o.disabled) return
    close()
    setErr(null)
    btnRef.current?.setCustomValidity('')
    if (o.value === valueRef.current) return
    valueRef.current = o.value
    if (hiddenRef.current) hiddenRef.current.value = o.value
    if (!isControlled) setInner(o.value)
    const tgt = { value: o.value, name: name ?? '' }
    onChange?.({ target: tgt, currentTarget: tgt, value: o.value, option: o })
    emitChange(hiddenRef.current)
  }

  // Formular: Pflichtfeld beim Absenden prüfen (auch bei noValidate), Zurücksetzen auf den Startwert
  const api = useRef({ submit: () => null as string | null, reset: () => {} })
  api.current.submit = () => {
    const msg = required && !valueRef.current ? t('common.field.errChoose') : null
    setErr(msg)
    if (msg) btnRef.current?.setAttribute('aria-invalid', 'true') // sofort, für die Fokus-Reihenfolge mehrerer Felder
    return msg
  }
  api.current.reset = () => {
    setErr(null)
    close()
    if (!isControlled) setInner(str(props.defaultValue))
  }
  useFormBinding(btnRef, api)

  useOutsideClose(open, [btnRef, popRef], close)

  // Klick auf das <label>: wie beim nativen <select> nur fokussieren, nicht öffnen
  useEffect(() => {
    const b = btnRef.current
    if (!b?.labels) return
    const labels = Array.from(b.labels)
    const h = (e: Event) => {
      if (b.contains(e.target as Node)) return
      fromLabel.current = true
      setTimeout(() => { fromLabel.current = false })
    }
    labels.forEach((l) => l.addEventListener('click', h))
    return () => labels.forEach((l) => l.removeEventListener('click', h))
  }, [structWrapped])

  // Aktive Option sichtbar halten (beim Öffnen mittig)
  const centered = useRef(false)
  useLayoutEffect(() => {
    if (!open) { centered.current = false; return }
    const list = listRef.current
    const el = active >= 0 ? document.getElementById(optId(active)) : null
    if (!list || !el) return
    const top = el.offsetTop // .sel-list ist position: relative
    if (!centered.current) {
      list.scrollTop = top - list.clientHeight / 2 + el.offsetHeight / 2
      centered.current = true
    } else if (top < list.scrollTop) list.scrollTop = top
    else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight
  }, [active, open])

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const now = Date.now()
    const typing = !!typed.current.buf && now - typed.current.at < TYPE_MS
    const act = selectKeyAction(e, open, typing)
    if (!act) return
    if (busy && act !== 'tab') { e.preventDefault(); return }
    switch (act) {
      case 'open': e.preventDefault(); return openList()
      case 'first':
      case 'last': {
        e.preventDefault()
        const i = act === 'first' ? firstEnabled(opts) : lastEnabled(opts)
        return open ? setActive(i) : openList(i)
      }
      case 'next': case 'prev': case 'pageNext': case 'pagePrev': {
        e.preventDefault()
        const d = act === 'next' ? 1 : act === 'prev' ? -1 : act === 'pageNext' ? 10 : -10
        return setActive((a) => moveActive(opts, a, d))
      }
      case 'select':
        e.preventDefault()
        return active >= 0 ? choose(active) : close()
      case 'close':
        e.preventDefault()
        e.stopPropagation() // umgebenden Dialog nicht schliessen
        return close()
      case 'tab':
        return open && active >= 0 ? choose(active) : close()
      case 'type': {
        e.preventDefault()
        typed.current = { buf: (typing ? typed.current.buf : '') + e.key, at: now }
        const from = open ? active : selIndex
        const i = typeahead(opts, from, typed.current.buf)
        if (!open) return openList(i)
        if (i >= 0) setActive(i)
      }
    }
  }

  const invalid = ids.invalid
  const shownErr = !structWrapped && err
  const describedBy = [ids.describedBy, shownErr ? ids.errId : null].filter(Boolean).join(' ') || undefined
  const labelledBy = props['aria-labelledby'] ?? (props.label != null && !props['aria-label'] ? ids.labelId : undefined)
  const isPh = !!selected?.placeholder
  const control = (
    <>
      <button
        ref={(el) => {
          btnRef.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) (ref as { current: HTMLButtonElement | null }).current = el
        }}
        type="button"
        id={ids.id}
        role="combobox"
        className={cx(!plain && 'field', 'sel-btn', className)}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={props['aria-label']}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || props['aria-required'] || undefined}
        aria-busy={busy || undefined}
        data-loading={busy || undefined}
        data-field={name}
        title={title}
        autoFocus={autoFocus}
        disabled={disabled}
        form={form}
        onKeyDown={onKeyDown}
        onClick={() => {
          if (fromLabel.current) { fromLabel.current = false; btnRef.current?.focus(); return }
          if (open) close()
          else openList()
        }}
        onFocus={props.onFocus}
        onBlur={(e) => {
          props.onBlur?.(e)
          if (popRef.current?.contains(e.relatedTarget as Node)) return
          if (open) close()
        }}
      >
        <span className="sel-val" data-ph={isPh || undefined}>{selected?.label ?? ''}</span>
        <span className="sel-chev" aria-hidden="true">{busy ? <span className="sel-spin" /> : <IconChevron dir="right" />}</span>
      </button>
      {name && <input ref={hiddenRef} type="hidden" name={name} form={form} value={value} disabled={disabled} data-for={ids.id} />}
      {shownErr && <p className="err fld-err" id={ids.errId} role="alert">{err}</p>}
      {open && (
        <SelectPopover anchor={btnRef} popRef={popRef} listRef={listRef} id={listId} labelledBy={labelledBy} label={props['aria-label']} title={props.label ?? props['aria-label']} onClose={() => { close(); btnRef.current?.focus() }} closeText={t('common.close')}>
          {groupRuns(opts).map((g, gi) => {
            const items = g.items.map((o, k) => {
              const i = g.start + k
              return (
                <div
                  key={i}
                  id={optId(i)}
                  role="option"
                  className="cb-opt sel-opt"
                  aria-selected={i === selIndex}
                  aria-disabled={o.disabled || undefined}
                  data-active={i === active || undefined}
                  data-ph={o.placeholder || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => { if (active !== i && !o.disabled) setActive(i) }}
                  onClick={() => { if (!o.disabled) { choose(i); btnRef.current?.focus({ preventScroll: true }) } }}
                >
                  <span className="cb-opt-l">{o.label}</span>
                </div>
              )
            })
            return g.group != null ? (
              <div key={'g' + gi} role="group" aria-labelledby={'sl' + uid + 'g' + gi}>
                <div className="cb-group" id={'sl' + uid + 'g' + gi} role="presentation">{g.group}</div>
                {items}
              </div>
            ) : <div key={'g' + gi} role="presentation">{items}</div>
          })}
        </SelectPopover>
      )}
    </>
  )
  return structWrapped ? <Field ids={ids} {...f}>{control}</Field> : control
}

/** Listbox im Portal (im offenen <dialog>, sonst body); Mobile als Blatt mit Titel und «Schliessen». */
function SelectPopover({ anchor, popRef, listRef, id, labelledBy, label, title, onClose, closeText, children }: {
  anchor: React.RefObject<HTMLButtonElement | null>
  popRef: React.RefObject<HTMLDivElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  id: string
  labelledBy?: string
  label?: string
  title?: ReactNode
  onClose: () => void
  closeText: string
  children: ReactNode
}) {
  const { sheet, style } = useAnchoredPopover(true, anchor, popRef, true)
  const target = portalTarget(anchor.current)
  if (!target) return null
  return createPortal(
    <>
      {sheet && <div className="dtf-scrim" aria-hidden="true" />}
      <div ref={popRef} className={'sel-pop' + (sheet ? ' is-sheet' : '')} style={style}>
        {sheet && title != null && <div className="dtf-sheet-title" aria-hidden="true">{title}</div>}
        <div ref={listRef} id={id} role="listbox" className="sel-list" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} tabIndex={-1}>
          {children}
        </div>
        {sheet && (
          <div className="dtf-foot">
            <button type="button" className="btn sm ghost dtf-close" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>{closeText}</button>
          </div>
        )}
      </div>
    </>,
    target,
  )
}
