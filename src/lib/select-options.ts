/**
 * Reine Logik der Auswahlliste `Select` (src/components/ui/fields/Select.tsx): Optionen aus den Kindern
 * (`<option>`/`<optgroup>` wie beim nativen <select>), Wert-Auflösung wie im Browser, Tastatur nach
 * WAI-ARIA «Select-only Combobox» und Tippen-zum-Springen (Typeahead).
 */
import { Children, isValidElement, type ReactNode } from 'react'
import { normalize } from './combobox'

export type SelectOpt = {
  value: string
  label: string
  disabled?: boolean
  /** Überschrift der <optgroup> */
  group?: string
  /** Platzhalter («Bitte wählen»): wird im Feld gedämpft angezeigt */
  placeholder?: boolean
}

type El = { type: unknown; props: Record<string, unknown> }

/** Sichtbarer Text eines Knotens (Strings, Zahlen, Arrays, Fragmente, verschachtelte Elemente). */
export function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node as unknown as El).props.children as ReactNode)
  return ''
}

const str = (v: unknown) => (v == null ? undefined : String(v))

/**
 * Liest `<option value>Text</option>` und `<optgroup label>` aus den Kindern (auch in Fragmenten und Arrays).
 * Ohne `value` gilt wie im Browser der Text. Deaktivierte Gruppen deaktivieren ihre Optionen.
 */
export function optionsFromChildren(children: ReactNode, placeholder?: string): SelectOpt[] {
  const out: SelectOpt[] = []
  if (placeholder != null) out.push({ value: '', label: placeholder, placeholder: true })
  const walk = (nodes: ReactNode, group?: string, groupDisabled?: boolean) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return
      const { type, props } = child as unknown as El
      if (type === 'option') {
        const label = (str(props.label) ?? textOf(props.children as ReactNode)).replace(/\s+/g, ' ').trim()
        const value = str(props.value) ?? label
        const disabled = !!props.disabled || !!groupDisabled
        out.push({ value, label, ...(disabled ? { disabled } : {}), ...(group != null ? { group } : {}), ...(value === '' && disabled ? { placeholder: true } : {}) })
      } else if (type === 'optgroup') {
        walk(props.children as ReactNode, str(props.label) ?? '', !!props.disabled)
      } else if (props && 'children' in props) {
        walk(props.children as ReactNode, group, groupDisabled) // Fragment o. Ä.
      }
    })
  }
  walk(children)
  return out
}

/** Wert wie beim nativen <select>: passende Option (auch deaktiviert), sonst die erste aktivierbare. */
export function resolveValue(opts: SelectOpt[], v: string | null | undefined): string {
  if (v != null && opts.some((o) => o.value === v)) return v
  return (opts.find((o) => !o.disabled) ?? opts[0])?.value ?? ''
}

export const indexOfValue = (opts: SelectOpt[], v: string) => opts.findIndex((o) => o.value === v)

/** Erste bzw. letzte aktivierbare Option; -1 wenn keine. */
export function firstEnabled(opts: SelectOpt[]): number {
  return opts.findIndex((o) => !o.disabled)
}
export function lastEnabled(opts: SelectOpt[]): number {
  for (let i = opts.length - 1; i >= 0; i--) if (!opts[i].disabled) return i
  return -1
}

/**
 * Bewegt die aktive Option um `delta` (±1 Pfeil, ±10 Bild auf/ab) ohne Umlauf und überspringt deaktivierte.
 * Am Rand bleibt die letzte aktivierbare Option in dieser Richtung aktiv.
 */
export function moveActive(opts: SelectOpt[], from: number, delta: number): number {
  if (!opts.length) return -1
  if (from < 0) return delta > 0 ? firstEnabled(opts) : lastEnabled(opts)
  const dir = delta > 0 ? 1 : -1
  const target = Math.max(0, Math.min(opts.length - 1, from + delta))
  // Ziel deaktiviert → weiter in derselben Richtung, sonst zurück Richtung Start
  for (let i = target; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i
  for (let i = target - dir; i !== from && i >= 0 && i < opts.length; i -= dir) if (!opts[i].disabled) return i
  return from
}

/**
 * Tippen springt zur ersten Option, deren Text mit der Eingabe beginnt (ohne Akzente/Grossschreibung),
 * gesucht ab der Option nach `from`. Gleiche Taste wiederholt («mmm») wechselt zwischen den Treffern.
 * -1 wenn nichts passt.
 */
export function typeahead(opts: SelectOpt[], from: number, buffer: string): number {
  const q = normalize(buffer)
  if (!q) return -1
  const n = opts.length
  const repeat = q.length > 1 && [...q].every((c) => c === q[0])
  const start = from < 0 ? 0 : from + 1
  const order = Array.from({ length: n }, (_, k) => (start + k) % n)
  const hit = (prefix: string) => order.find((i) => !opts[i].disabled && normalize(opts[i].label).startsWith(prefix))
  // Eine neue Folge (mehrere Zeichen) bleibt möglichst bei der aktuellen Option
  if (q.length > 1 && !repeat && from >= 0 && !opts[from].disabled && normalize(opts[from].label).startsWith(q)) return from
  return hit(q) ?? (repeat ? hit(q[0]) : undefined) ?? -1
}

export type SelectAction = 'open' | 'first' | 'last' | 'next' | 'prev' | 'pageNext' | 'pagePrev' | 'select' | 'close' | 'tab' | 'type' | null

/**
 * Taste → Aktion (WAI-ARIA APG «Select-only Combobox»).
 * Geschlossen: ↓ ↑ Enter Leertaste öffnen (aktive Option = gewählte), Pos1/Ende öffnen auf der ersten/letzten,
 * Zeichen öffnen und springen. Offen: ↑↓ bewegen, Bild auf/ab ±10, Pos1/Ende, Enter/Leertaste/Alt+↑ übernehmen,
 * Esc schliesst ohne Änderung, Tab übernimmt und geht weiter. Leertaste zählt während des Tippens als Zeichen.
 */
export function selectKeyAction(e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, open: boolean, typing = false): SelectAction {
  const { key } = e
  const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
  if (key === ' ' && typing) return 'type'
  if (!open) {
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') return 'open'
    if (key === 'Home') return 'first'
    if (key === 'End') return 'last'
    return printable ? 'type' : null
  }
  switch (key) {
    case 'ArrowDown': return e.altKey ? null : 'next'
    case 'ArrowUp': return e.altKey ? 'select' : 'prev'
    case 'PageDown': return 'pageNext'
    case 'PageUp': return 'pagePrev'
    case 'Home': return 'first'
    case 'End': return 'last'
    case 'Enter':
    case ' ': return 'select'
    case 'Escape': return 'close'
    case 'Tab': return 'tab'
  }
  return printable ? 'type' : null
}

/** Gruppen in Anzeige-Reihenfolge (aufeinanderfolgende Optionen mit gleicher Gruppe), mit Startindex. */
export function groupRuns(opts: SelectOpt[]): { group: string | undefined; start: number; items: SelectOpt[] }[] {
  const out: { group: string | undefined; start: number; items: SelectOpt[] }[] = []
  opts.forEach((o, i) => {
    const last = out[out.length - 1]
    if (last && last.group === o.group) last.items.push(o)
    else out.push({ group: o.group, start: i, items: [o] })
  })
  return out
}
