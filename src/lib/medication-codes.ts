/**
 * Codes an Medikamenten (PRD §13.1, §58): ATC (WHO-Klassifikation) und GTIN (GS1, Packung; Schweiz 7680…).
 * Grundlage für Interaktionsprüfung und Katalog-Anbindung. Reine Logik (Server, Client, Tests).
 */

/** ATC auf Ebene 1–5: A · A10 · A10B · A10BA · A10BA02. Leerzeichen werden entfernt, Grossbuchstaben. */
export function normalizeAtc(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, '').toUpperCase()
}
const ATC_RE = /^[A-Z](\d{2}([A-Z]([A-Z](\d{2})?)?)?)?$/
export const isValidAtc = (v: string) => ATC_RE.test(v)
/** Nur der vollständige Code (Ebene 5, Wirkstoff) eignet sich für eine Interaktionsprüfung. */
export const isSubstanceAtc = (v: string) => /^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(v)

export function normalizeGtin(v: string | null | undefined): string {
  return (v ?? '').replace(/[\s-]/g, '')
}
/** GTIN-8/12/13/14 mit Prüfziffer (Modulo 10, Gewichtung 3/1 von rechts). */
export function isValidGtin(v: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v)) return false
  const digits = v.split('').map(Number)
  const check = digits.pop()!
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export type CodeCheck = { atc: string | null; gtin: string | null; error?: { field: 'atc' | 'gtin'; key: string } }

/** Eingaben prüfen und normalisieren; leere Felder sind erlaubt (Codes sind optional). */
export function parseCodes(input: { atc?: string | null; gtin?: string | null }): CodeCheck {
  const atc = normalizeAtc(input.atc)
  const gtin = normalizeGtin(input.gtin)
  if (atc && !isValidAtc(atc)) return { atc: null, gtin: null, error: { field: 'atc', key: 'meds.codes.atcInvalid' } }
  if (gtin && !isValidGtin(gtin)) return { atc: null, gtin: null, error: { field: 'gtin', key: 'meds.codes.gtinInvalid' } }
  return { atc: atc || null, gtin: gtin || null }
}
