/**
 * Strukturierte Formulare (PRD §10.3 Fokusdokumentation, §45 Klinische Konfiguration – Formulare).
 * Reine Logik ohne Server-Abhängigkeiten: Felddefinitionen prüfen, Eingaben validieren,
 * Textzusammenfassung erzeugen. Auf Server und Client nutzbar.
 */

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'select', 'multiselect', 'checkbox', 'date', 'time', 'scale'] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export type FormField = {
  key: string
  label: string
  type: FormFieldType
  options?: string[]
  unit?: string
  min?: number
  max?: number
  required?: boolean
}

export type FormValue = string | number | boolean | string[] | null
export type FormValues = Record<string, FormValue>

/** Momentaufnahme in Observation.structured: bleibt lesbar, auch wenn das Formular später geändert wird. */
export type StructuredForm = {
  formKey: string
  formVersion: number
  formName: string
  values: FormValues
  labels: Record<string, string>
  units?: Record<string, string>
}

export const FORM_LIMITS = { fields: 40, options: 30, label: 120, option: 80, text: 2000, textarea: 4000 } as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Stabiler Feldschlüssel aus einer Bezeichnung (ohne Umlaute/Sonderzeichen). */
export function fieldKey(label: string) {
  return label
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

const num = (v: unknown) => {
  if (v === '' || v == null) return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Prüft und normalisiert Felddefinitionen aus dem Formular-Editor.
 * Fehler sind i18n-Schlüssel (Namespace forms) mit Feldindex.
 */
export function normalizeFields(raw: unknown): { ok: true; fields: FormField[] } | { ok: false; error: string; index?: number } {
  if (!Array.isArray(raw)) return { ok: false, error: 'forms.errors.fields' }
  if (!raw.length) return { ok: false, error: 'forms.errors.noFields' }
  if (raw.length > FORM_LIMITS.fields) return { ok: false, error: 'forms.errors.tooMany' }
  const out: FormField[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i] as Record<string, unknown>
    if (!f || typeof f !== 'object') return { ok: false, error: 'forms.errors.fields', index: i }
    const label = String(f.label ?? '').trim().slice(0, FORM_LIMITS.label)
    if (!label) return { ok: false, error: 'forms.errors.label', index: i }
    const type = String(f.type ?? '') as FormFieldType
    if (!FORM_FIELD_TYPES.includes(type)) return { ok: false, error: 'forms.errors.type', index: i }
    let key = fieldKey(String(f.key ?? '') || label) || 'feld_' + (i + 1)
    while (seen.has(key)) key = key.slice(0, 36) + '_' + (i + 1)
    seen.add(key)
    const field: FormField = { key, label, type }
    if (f.required) field.required = true
    if (type === 'select' || type === 'multiselect') {
      const opts = (Array.isArray(f.options) ? f.options : String(f.options ?? '').split('\n'))
        .map((o) => String(o).trim().slice(0, FORM_LIMITS.option))
        .filter(Boolean)
      const uniq = [...new Set(opts)]
      if (uniq.length < 2) return { ok: false, error: 'forms.errors.options', index: i }
      if (uniq.length > FORM_LIMITS.options) return { ok: false, error: 'forms.errors.tooManyOptions', index: i }
      field.options = uniq
    }
    if (type === 'number' || type === 'scale') {
      const min = num(f.min)
      const max = num(f.max)
      if (Number.isNaN(min) || Number.isNaN(max)) return { ok: false, error: 'forms.errors.range', index: i }
      if (type === 'scale' && (min == null || max == null)) return { ok: false, error: 'forms.errors.scaleRange', index: i }
      if (min != null && max != null && min >= max) return { ok: false, error: 'forms.errors.range', index: i }
      if (type === 'scale' && (!Number.isInteger(min) || !Number.isInteger(max) || max! - min! > 20)) return { ok: false, error: 'forms.errors.scaleRange', index: i }
      if (min != null) field.min = min
      if (max != null) field.max = max
    }
    if (type === 'number' || type === 'text') {
      const unit = String(f.unit ?? '').trim().slice(0, 16)
      if (unit) field.unit = unit
    }
    out.push(field)
  }
  return { ok: true, fields: out }
}

/** Liest Felddefinitionen aus der DB (Json) tolerant ein. */
export function readFields(json: unknown): FormField[] {
  const r = normalizeFields(json)
  return r.ok ? r.fields : []
}

export type FieldError = 'required' | 'number' | 'min' | 'max' | 'option' | 'date' | 'time' | 'long'

/**
 * Validiert Eingaben gegen die Felddefinitionen. Liefert normalisierte Werte
 * (Zahlen als number, Mehrfachauswahl als string[], leere Felder weggelassen) und Fehler pro Feld.
 */
export function validateFormValues(fields: FormField[], raw: Record<string, unknown>): { ok: boolean; values: FormValues; errors: Record<string, FieldError> } {
  const values: FormValues = {}
  const errors: Record<string, FieldError> = {}
  for (const f of fields) {
    const v = raw[f.key]
    switch (f.type) {
      case 'checkbox': {
        const b = v === true || v === 'true' || v === 'on'
        if (f.required && !b) errors[f.key] = 'required'
        values[f.key] = b
        break
      }
      case 'multiselect': {
        const arr = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(String)
        if (arr.some((x) => !f.options?.includes(x))) { errors[f.key] = 'option'; break }
        if (!arr.length) { if (f.required) errors[f.key] = 'required'; break }
        // Reihenfolge wie in der Definition
        values[f.key] = (f.options ?? []).filter((o) => arr.includes(o))
        break
      }
      case 'number':
      case 'scale': {
        const n = num(v)
        if (n === undefined) { if (f.required) errors[f.key] = 'required'; break }
        if (Number.isNaN(n) || (f.type === 'scale' && !Number.isInteger(n))) { errors[f.key] = 'number'; break }
        if (f.min != null && n < f.min) { errors[f.key] = 'min'; break }
        if (f.max != null && n > f.max) { errors[f.key] = 'max'; break }
        values[f.key] = n
        break
      }
      default: {
        const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
        if (!s) { if (f.required) errors[f.key] = 'required'; break }
        if (f.type === 'select' && !f.options?.includes(s)) { errors[f.key] = 'option'; break }
        if (f.type === 'date' && (!DATE_RE.test(s) || Number.isNaN(new Date(s + 'T00:00:00').getTime()))) { errors[f.key] = 'date'; break }
        if (f.type === 'time' && !TIME_RE.test(s)) { errors[f.key] = 'time'; break }
        if (s.length > (f.type === 'textarea' ? FORM_LIMITS.textarea : FORM_LIMITS.text)) { errors[f.key] = 'long'; break }
        values[f.key] = s
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, values, errors }
}

/** Ob ein Wert als "ausgefüllt" gilt (für Zusammenfassung und Anzeige). */
export const hasValue = (v: FormValue | undefined) => v != null && v !== '' && !(Array.isArray(v) && !v.length)

/** Wert lesbar formatieren (Ja/Nein, Liste, Einheit, Datum TT.MM.JJJJ). */
export function formatFormValue(v: FormValue | undefined, words: { yes: string; no: string }, unit?: string) {
  if (v == null) return '–'
  if (typeof v === 'boolean') return v ? words.yes : words.no
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return String(v).replace('.', ',') + (unit ? ' ' + unit : '')
  if (DATE_RE.test(v)) return v.slice(8, 10) + '.' + v.slice(5, 7) + '.' + v.slice(0, 4)
  return v + (unit ? ' ' + unit : '')
}

/**
 * Lesbare Textzusammenfassung für Verlauf, Übergabe, Suche und Export:
 * "Sturzprotokoll: Ort: Zimmer; Schmerz (NRS): 3; Arzt informiert: Ja."
 * Nicht ausgefüllte Felder werden weggelassen; Kontrollkästchen erscheinen immer (Ja/Nein ist fachlich relevant).
 */
export function formSummary(name: string, fields: FormField[], values: FormValues, words: { yes: string; no: string }) {
  const parts: string[] = []
  for (const f of fields) {
    const v = values[f.key]
    if (!hasValue(v)) continue
    const text = formatFormValue(v, words, f.unit).replace(/\s+/g, ' ')
    parts.push(`${f.label}: ${text}`)
  }
  return parts.length ? `${name}: ${parts.join('; ')}.` : `${name}.`
}

/** Momentaufnahme für Observation.structured bauen. */
export function structuredSnapshot(def: { key: string; version: number; name: string }, fields: FormField[], values: FormValues): StructuredForm {
  const labels: Record<string, string> = {}
  const units: Record<string, string> = {}
  for (const f of fields) {
    labels[f.key] = f.label
    if (f.unit) units[f.key] = f.unit
  }
  return { formKey: def.key, formVersion: def.version, formName: def.name, values, labels, ...(Object.keys(units).length ? { units } : {}) }
}

/** Erkennt eine Formular-Momentaufnahme in Observation.structured. */
export function asStructuredForm(s: unknown): StructuredForm | null {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const o = s as Record<string, unknown>
  if (typeof o.formKey !== 'string' || !o.values || typeof o.values !== 'object' || !o.labels || typeof o.labels !== 'object') return null
  return {
    formKey: o.formKey,
    formVersion: Number(o.formVersion) || 1,
    formName: typeof o.formName === 'string' ? o.formName : o.formKey,
    values: o.values as FormValues,
    labels: o.labels as Record<string, string>,
    units: o.units && typeof o.units === 'object' ? (o.units as Record<string, string>) : undefined,
  }
}

/** Haben sich Felder inhaltlich geändert? (Massgeblich für die Versionierung.) */
export const fieldsChanged = (a: FormField[], b: FormField[]) => JSON.stringify(a) !== JSON.stringify(b)

/** Standardformulare für neue Organisationen und die Demo (Seed, Bootstrap). */
export const DEFAULT_FORMS: { key: string; name: string; category: 'care' | 'observation' | 'incident'; description: string; fields: FormField[] }[] = [
  {
    key: 'sturzprotokoll', name: 'Sturzprotokoll', category: 'incident',
    description: 'Strukturierte Erfassung direkt nach einem Sturz. Ergänzt die Ereignismeldung.',
    fields: [
      { key: 'ort', label: 'Ort', type: 'select', options: ['Zimmer', 'Badezimmer', 'Korridor', 'Aufenthaltsraum', 'Aussenbereich', 'Anderer Ort'], required: true },
      { key: 'uhrzeit', label: 'Uhrzeit', type: 'time', required: true },
      { key: 'aufgefunden', label: 'Aufgefunden wie', type: 'textarea', required: true },
      { key: 'verletzungen', label: 'Verletzungen', type: 'multiselect', options: ['Keine sichtbar', 'Hämatom', 'Schürfung', 'Platzwunde', 'Verdacht auf Fraktur', 'Kopfverletzung'] },
      { key: 'schmerz', label: 'Schmerz (NRS)', type: 'scale', min: 0, max: 10, required: true },
      { key: 'massnahmen', label: 'Massnahmen', type: 'textarea' },
      { key: 'arzt', label: 'Arzt informiert', type: 'checkbox', required: false },
    ],
  },
  {
    key: 'schmerzerfassung', name: 'Schmerzerfassung', category: 'observation',
    description: 'Schmerzeinschätzung mit Wirkungskontrolle nach 30 Minuten.',
    fields: [
      { key: 'lokalisation', label: 'Lokalisation', type: 'text', required: true },
      { key: 'nrs', label: 'Schmerzintensität (NRS)', type: 'scale', min: 0, max: 10, required: true },
      { key: 'charakter', label: 'Charakter', type: 'multiselect', options: ['stechend', 'dumpf', 'brennend', 'ziehend', 'krampfartig', 'pochend'] },
      { key: 'massnahme', label: 'Massnahme', type: 'textarea' },
      { key: 'wirkung', label: 'Wirkung nach 30 Min. (NRS)', type: 'scale', min: 0, max: 10 },
    ],
  },
  {
    key: 'ausscheidung', name: 'Ausscheidung/Bilanz', category: 'care',
    description: 'Ein- und Ausfuhr, Stuhlbeschaffenheit nach Bristol-Skala.',
    fields: [
      { key: 'urin', label: 'Urin', type: 'number', unit: 'ml', min: 0, max: 5000 },
      { key: 'stuhl', label: 'Stuhl (Bristol)', type: 'scale', min: 1, max: 7 },
      { key: 'erbrechen', label: 'Erbrechen', type: 'checkbox' },
      { key: 'einfuhr', label: 'Einfuhr', type: 'number', unit: 'ml', min: 0, max: 8000 },
    ],
  },
]
