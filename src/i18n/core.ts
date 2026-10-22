/** i18n-Kern ohne Server-Abhängigkeiten – auf Server und Client nutzbar. */
export const LOCALES = ['de', 'fr', 'it', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', fr: 'Français', it: 'Italiano', en: 'English' }
export const INTL_LOCALE: Record<Locale, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-GB' }

export type Tree = { [k: string]: string | Tree }
type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> }

/** Erzwingt zur Compile-Zeit, dass jede Sprache dieselben Schlüssel hat wie Deutsch. */
export function defineMessages<T extends Tree>(m: { de: T; fr: Shape<T>; it: Shape<T>; en: Shape<T> }) {
  return m as unknown as Record<Locale, Tree>
}

export type Terminology = 'resident' | 'patient' | 'client'
export type Vars = Record<string, string | number | null | undefined>

/** Terminologie je Organisation (PRD §53): Bewohner, Patient oder Klient. */
export const TERMS: Record<Locale, Record<Terminology, { one: string; other: string; One: string; Other: string }>> = {
  de: {
    resident: { one: 'Bewohner/in', other: 'Bewohnende', One: 'Bewohner/in', Other: 'Bewohnende' },
    patient: { one: 'Patient/in', other: 'Patient/innen', One: 'Patient/in', Other: 'Patient/innen' },
    client: { one: 'Klient/in', other: 'Klient/innen', One: 'Klient/in', Other: 'Klient/innen' },
  },
  fr: {
    resident: { one: 'résident·e', other: 'résident·e·s', One: 'Résident·e', Other: 'Résident·e·s' },
    patient: { one: 'patient·e', other: 'patient·e·s', One: 'Patient·e', Other: 'Patient·e·s' },
    client: { one: 'client·e', other: 'client·e·s', One: 'Client·e', Other: 'Client·e·s' },
  },
  it: {
    resident: { one: 'residente', other: 'residenti', One: 'Residente', Other: 'Residenti' },
    patient: { one: 'paziente', other: 'pazienti', One: 'Paziente', Other: 'Pazienti' },
    client: { one: 'cliente', other: 'clienti', One: 'Cliente', Other: 'Clienti' },
  },
  en: {
    resident: { one: 'resident', other: 'residents', One: 'Resident', Other: 'Residents' },
    patient: { one: 'patient', other: 'patients', One: 'Patient', Other: 'Patients' },
    client: { one: 'client', other: 'clients', One: 'Client', Other: 'Clients' },
  },
}

function lookup(dict: Tree, key: string): string | undefined {
  let cur: string | Tree | undefined = dict
  for (const part of key.split('.')) {
    if (cur == null || typeof cur === 'string') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/**
 * Formatiert eine Nachricht. Unterstützt {name} und {n, plural, one {…} other {…}} (mit # als Zahl).
 * Terminologie steht als {resident}, {residents}, {Resident}, {Residents} zur Verfügung.
 */
export function format(template: string, vars: Vars, locale: Locale) {
  const pr = new Intl.PluralRules(INTL_LOCALE[locale])
  // Einfache Platzhalter zuerst, damit sie auch innerhalb von Pluralformen ersetzt werden.
  let out = template.replace(/\{(\w+)\}/g, (m, name: string) => (vars[name] == null ? m : String(vars[name])))
  out = out.replace(/\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g, (_, name: string, body: string) => {
    const n = Number(vars[name] ?? 0)
    const forms: Record<string, string> = {}
    body.replace(/(=?\w+)\s*\{([^{}]*)\}/g, (_m: string, k: string, v: string) => ((forms[k] = v), ''))
    const form = forms['=' + n] ?? forms[pr.select(n)] ?? forms.other ?? ''
    return form.replace(/#/g, String(n))
  })
  return out
}

export type TFn = (key: string, vars?: Vars) => string

export function makeT(dict: Tree, locale: Locale, terminology: Terminology): TFn {
  const term = TERMS[locale][terminology]
  const base: Vars = { resident: term.one, residents: term.other, Resident: term.One, Residents: term.Other }
  return (key, vars) => {
    const tpl = lookup(dict, key)
    if (tpl == null) {
      if (process.env.NODE_ENV !== 'production') console.warn('[i18n] missing', locale, key)
      return key
    }
    return format(tpl, vars ? { ...base, ...vars } : base, locale)
  }
}

export function pickLocale(input: string | null | undefined): Locale {
  if (!input) return 'de'
  for (const part of input.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase()
    if ((LOCALES as readonly string[]).includes(code)) return code as Locale
  }
  return 'de'
}
