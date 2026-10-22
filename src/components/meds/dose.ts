/**
 * Dosis immer mit Einheit anzeigen (PRD §32 "klare Einheiten").
 * Verordnungen speichern die Dosis oft als reine Zahl ("1", "0,5", "½") und die Einheit in der Darreichungsform ("Tbl.").
 * Darreichungsformen, die nur einen Applikationsweg nennen ("s.c."), werden nicht angehängt.
 */
const NUMERIC = /^\s*(\d+(?:[.,]\d+)?|\d+\/\d+|[½¼¾])\s*$/
const ROUTE_ONLY = /^(p\.o\.|s\.c\.|i\.v\.|i\.m\.|s\.l\.|rektal|kutan|transdermal|inhalativ|nasal)$/i

export function doseText(dose: string | null | undefined, form: string | null | undefined): string {
  const d = (dose ?? '').trim()
  const f = (form ?? '').trim()
  if (!d) return ''
  if (!f || !NUMERIC.test(d) || ROUTE_ONLY.test(f)) return d
  // Form enthält schon eine Menge ("4 gtt.", "10 ml"): bei Dosis 1 genau diese Menge, sonst als Vielfaches.
  if (/^\d/.test(f)) return d === '1' ? f : `${d} × ${f}`
  return `${d} ${f}`
}
