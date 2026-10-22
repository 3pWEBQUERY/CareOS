/**
 * Anzeigename eines Diensttyps in der Sprache der Person (client- und serverseitig nutzbar).
 * Diensttypen stammen aus der Datenbank; die beim Seed/Bootstrap angelegten deutschen Standardnamen
 * für F/S/N werden übersetzt, eigene Namen der Organisation bleiben unverändert.
 */
const DEFAULTS: Record<string, { name: string; key: 'early' | 'late' | 'night' }> = {
  F: { name: 'frühdienst', key: 'early' },
  S: { name: 'spätdienst', key: 'late' },
  N: { name: 'nachtdienst', key: 'night' },
}

type T = (key: string) => string

export function isDefaultShiftName(s: { code: string; name: string }) {
  const d = DEFAULTS[s.code]
  return !!d && s.name.trim().toLowerCase() === d.name
}

/** `short`: Kurzform («Früh», «Matin» …) für knappe Ansichten; eigene Namen werden dann nur um «dienst» gekürzt. */
export function shiftName(t: T, s: { code: string; name: string }, opts?: { short?: boolean }): string {
  const d = DEFAULTS[s.code]
  if (d && isDefaultShiftName(s)) return t(`common.shifts.${d.key}${opts?.short ? 'Short' : ''}`)
  return opts?.short ? s.name.replace(/dienst$/i, '') || s.name : s.name
}
