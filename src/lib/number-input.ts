/**
 * Zahleneingabe in der App-Sprache (NumberField): tolerant beim Parsen (Komma oder Punkt als Dezimalzeichen,
 * Tausendertrennzeichen ’ ' und Leerzeichen), Anzeige mit dem Dezimalzeichen der Sprache, Formularwert immer
 * mit Punkt («38.1»), damit Server Actions unverändert bleiben. Ohne Server-Abhängigkeiten.
 */
import { INTL_LOCALE, type Locale } from '@/i18n/core'

/** Dezimalzeichen der Sprache laut Intl (de-CH «.», fr-CH «,», it-CH «.», en-GB «.»). */
export function decimalSeparator(locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
}

/**
 * Text → Zahl. Leer → '' ; ungültig → null.
 * - Leerzeichen (auch schmale), ’ und ' gelten als Tausendertrennzeichen.
 * - Kommen Komma und Punkt vor, ist das letzte Zeichen das Dezimalzeichen.
 * - Nur Komma: Dezimalzeichen – ausser auf Englisch bei Gruppen zu drei Ziffern («1,500» = 1500).
 * - Mehrere Punkte ohne Komma: Tausendertrennzeichen («1.234.567»).
 * - Vorzeichen «-», «−» und «+».
 */
export function parseNumber(input: string, locale: Locale): number | '' | null {
  let s = String(input ?? '').trim()
  if (!s) return ''
  s = s.replace(/[\s  ’']/g, '').replace(/^−/, '-')
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const sign = s[0] === '-' ? -1 : 1
  s = s.replace(/^[+-]/, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let intPart: string
  let frac = ''
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.'
    const grp = dec === ',' ? '.' : ','
    const i = s.lastIndexOf(dec)
    intPart = s.slice(0, i)
    frac = s.slice(i + 1)
    if (frac.includes(grp) || frac.includes(dec) || !validGroups(intPart, grp)) return null
    intPart = intPart.split(grp).join('')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const ch = lastComma >= 0 ? ',' : '.'
    const parts = s.split(ch)
    const grouping = parts.length > 2 || (ch === ',' && locale === 'en' && /^\d{1,3}(,\d{3})+$/.test(s))
    if (grouping) {
      if (!validGroups(s, ch)) return null
      intPart = parts.join('')
    } else {
      intPart = parts[0]
      frac = parts[1]
    }
  } else intPart = s
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (!intPart && !frac)) return null
  const n = Number((intPart || '0') + (frac ? '.' + frac : ''))
  return Number.isFinite(n) ? sign * n || 0 : null
}

/** «1.234.567» bzw. «1,234»: erste Gruppe 1–3 Ziffern, danach je genau drei. */
function validGroups(s: string, grp: string) {
  if (!s.includes(grp)) return /^\d*$/.test(s)
  const g = s.split(grp)
  return /^\d{1,3}$/.test(g[0]) && g.slice(1).every((x) => /^\d{3}$/.test(x))
}

/** Anzeige im Feld: Dezimalzeichen der Sprache, ohne Tausendertrennzeichen; `decimals` fixiert die Nachkommastellen. */
export function formatNumberInput(n: number | null | undefined, locale: Locale, decimals?: number): string {
  if (n == null || !Number.isFinite(n)) return ''
  const s = decimals != null ? n.toFixed(decimals) : String(n)
  return s.replace('.', decimalSeparator(locale)).replace('-', '−')
}

/** Formularwert (Server Actions): immer mit Punkt. */
export const toFormNumber = (n: number) => String(n)

/** Startwert (Zahl oder Text aus der DB/Form) als Zahl; Text wird wie Eingabe geparst. */
export function initialNumber(v: number | string | null | undefined, locale: Locale): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const p = parseNumber(v, locale)
  return typeof p === 'number' ? p : null
}

export type NumberCheck =
  | { kind: 'ok'; value: number | '' }
  | { kind: 'invalid' }
  | { kind: 'min' | 'max'; value: number }
  | { kind: 'step'; value: number }

/** Prüft Text gegen min/max/step (step nur für ganze Zahlen: step=1 verlangt ganze Werte). */
export function checkNumber(raw: string, locale: Locale, o: { min?: number; max?: number; step?: number | 'any' } = {}): NumberCheck {
  const v = parseNumber(raw, locale)
  if (v === null) return { kind: 'invalid' }
  if (v === '') return { kind: 'ok', value: '' }
  if (o.min != null && v < o.min) return { kind: 'min', value: v }
  if (o.max != null && v > o.max) return { kind: 'max', value: v }
  if (typeof o.step === 'number' && o.step > 0) {
    const base = o.min ?? 0
    const q = (v - base) / o.step
    if (Math.abs(q - Math.round(q)) > 1e-9) return { kind: 'step', value: v }
  }
  return { kind: 'ok', value: v }
}

/** Plausibilität (Warnung, kein Fehler): ausserhalb [lo, hi] → 'low' | 'high'. */
export function plausibility(v: number | '' | null, warn?: { lo?: number; hi?: number }): 'low' | 'high' | null {
  if (typeof v !== 'number' || !warn) return null
  if (warn.lo != null && v < warn.lo) return 'low'
  if (warn.hi != null && v > warn.hi) return 'high'
  return null
}

/** Pfeiltasten: um step erhöhen/verringern, auf step-Raster und in [min, max]. */
export function stepNumber(v: number | '' | null, dir: 1 | -1, o: { min?: number; max?: number; step?: number | 'any' } = {}): number {
  const step = typeof o.step === 'number' && o.step > 0 ? o.step : 1
  const cur = typeof v === 'number' ? v : (o.min ?? 0) - (dir > 0 ? step : -step)
  const dec = (String(step).split('.')[1] ?? '').length
  let n = Number((cur + dir * step).toFixed(Math.min(10, dec + 2)))
  n = Number(n.toFixed(dec))
  if (o.min != null && n < o.min) n = o.min
  if (o.max != null && n > o.max) n = o.max
  return n
}
