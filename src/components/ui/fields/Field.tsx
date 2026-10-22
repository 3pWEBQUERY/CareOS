/**
 * Gemeinsamer Feld-Rahmen des Design Systems (PRD §50): Label, «optional», Einheit, Hinweis und
 * Fehlermeldung – mit `id`/`aria-describedby`/`aria-invalid` am Steuerelement. Ohne Client-State, damit
 * Server-Seiten die Felder ohne `'use client'` nutzen können (useId ist in Server Components erlaubt).
 *
 * Aufbau: <div.fld> <label.lbl for> … </label> [Steuerelement] <p.hint> <p.err role=alert> <span data-err-slot> </div>
 * Der leere Platz `data-err-slot` nimmt Fehler aus ActionForm (`r.field`) direkt am Feld auf.
 */
import { useId, type CSSProperties, type ReactNode } from 'react'
import { OptionalMark } from './marks'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ') || undefined

/** Props, die jedes Feld zusätzlich zu den nativen Attributen kennt. */
export type FieldProps = {
  /** Sichtbare Beschriftung. Ohne label (und ohne hint/error/unit) wird nur das Steuerelement gerendert. */
  label?: ReactNode
  /** Beschriftung nur für Screenreader (z. B. in Tabellenzellen). */
  hideLabel?: boolean
  /** Kurzer Hinweis unter dem Feld (über aria-describedby verbunden). */
  hint?: ReactNode
  /** Fehlermeldung am Feld (setzt aria-invalid). */
  error?: ReactNode
  /** Kennzeichnet ein freiwilliges Feld mit «optional». Pflichtfelder tragen `required`. */
  optional?: boolean
  /** Einheit als Suffix im Feld (z. B. «mg», «°C»); wird mit vorgelesen. */
  unit?: ReactNode
  /** Klasse/Stil des Rahmens `.fld` (z. B. «span-all» im .form-grid). */
  wrapClassName?: string
  wrapStyle?: CSSProperties
}

export const FIELD_KEYS = ['label', 'hideLabel', 'hint', 'error', 'optional', 'unit', 'wrapClassName', 'wrapStyle'] as const

/** Trennt Feld-Props von den nativen Props des Steuerelements. */
export function splitField<P extends FieldProps>(p: P): [FieldProps, Omit<P, keyof FieldProps>] {
  const f: Record<string, unknown> = {}
  const rest: Record<string, unknown> = { ...p }
  for (const k of FIELD_KEYS) {
    if (k in rest) {
      f[k] = rest[k]
      delete rest[k]
    }
  }
  return [f as FieldProps, rest as Omit<P, keyof FieldProps>]
}

export type FieldIds = {
  /** id des Steuerelements */
  id: string
  hintId: string
  errId: string
  unitId: string
  labelId: string
  /** aria-describedby fürs Steuerelement (eigene + übergebene) */
  describedBy: string | undefined
  invalid: boolean
  /** Rahmen nötig? (sonst nur das Steuerelement) */
  wrapped: boolean
}

/** ids und ARIA-Verknüpfungen eines Felds (Server und Client). */
export function useFieldIds(f: FieldProps, own: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown }): FieldIds {
  const uid = useId()
  const id = own.id ?? 'f' + uid.replace(/[^\w-]/g, '')
  const wrapped = f.label != null || f.hint != null || (f.error != null && f.error !== false && f.error !== '') || f.unit != null
  const hasErr = f.error != null && f.error !== false && f.error !== ''
  const describedBy = [own['aria-describedby'], f.unit != null ? id + '-u' : null, f.hint != null ? id + '-h' : null, hasErr ? id + '-e' : null]
    .filter(Boolean).join(' ') || undefined
  return {
    id, hintId: id + '-h', errId: id + '-e', unitId: id + '-u', labelId: id + '-l', describedBy,
    invalid: hasErr || own['aria-invalid'] === true || own['aria-invalid'] === 'true',
    wrapped,
  }
}

/**
 * Rahmen um ein Steuerelement. Für eigene Steuerelemente: `ids` aus useFieldIds übergeben und
 * `id`/`aria-describedby`/`aria-invalid` selbst am Steuerelement setzen.
 */
export function Field({ ids, label, hideLabel, hint, error, optional, unit, wrapClassName, wrapStyle, children, after, labelFor = true }: FieldProps & {
  ids: FieldIds
  children: ReactNode
  /** Zusätzlicher Inhalt unter dem Steuerelement (z. B. Plausibilitätswarnung, Zeichenzähler) */
  after?: ReactNode
  /** false: Label ohne for (Gruppen, eigene Steuerelemente mit aria-labelledby). */
  labelFor?: boolean
}) {
  const hasErr = error != null && error !== false && error !== ''
  return (
    <div className={cx('fld', wrapClassName)} style={wrapStyle} data-invalid={hasErr || undefined}>
      {label != null && (
        <label className={cx('lbl', hideLabel && 'sr-only')} htmlFor={labelFor ? ids.id : undefined} id={ids.labelId}>
          {label}
          {optional && <OptionalMark />}
        </label>
      )}
      {unit != null ? (
        <div className="fld-ctl">
          {children}
          <span className="fld-unit" id={ids.unitId}>{unit}</span>
        </div>
      ) : children}
      {after}
      {hint != null && <p className="hint fld-hint" id={ids.hintId}>{hint}</p>}
      {hasErr && <p className="err fld-err" id={ids.errId} role="alert">{error}</p>}
      <span className="fld-slot" data-err-slot="" />
    </div>
  )
}

/** Steuerelement im Rahmen (falls nötig) – gemeinsamer Abschluss der einfachen Felder. */
export function wrap(f: FieldProps, ids: FieldIds, control: ReactNode) {
  return ids.wrapped ? <Field ids={ids} {...f}>{control}</Field> : control
}
