/**
 * Konflikterkennung beim Bearbeiten (PRD §32): Dreiweg-Vergleich zwischen dem Stand beim Öffnen (base),
 * dem aktuellen Stand (current) und der eigenen Eingabe (mine). Nicht überlappende Änderungen werden
 * zusammengeführt; ein Feld, das beide unterschiedlich geändert haben, ist ein Konflikt. Server und Client.
 */
export const normValue = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : v ?? null)

/** Momentaufnahme der Felder als JSON-taugliche Werte (Datum als ISO-Text). */
export function snapshot(obj: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, JSON.parse(normValue(obj[k]))])) as Record<string, unknown>
}

export function threeWay(base: Record<string, unknown>, current: Record<string, unknown>, mine: Record<string, unknown>, keys: readonly string[]) {
  const eq = (a: unknown, b: unknown) => normValue(a) === normValue(b)
  const mineChanged = keys.filter((k) => !eq(mine[k], base[k]))
  const theirsChanged = keys.filter((k) => !eq(current[k], base[k]))
  const conflicts = mineChanged.filter((k) => theirsChanged.includes(k) && !eq(mine[k], current[k]))
  const merged: Record<string, unknown> = { ...current }
  for (const k of mineChanged) merged[k] = mine[k]
  return { conflicts, mineChanged, theirsChanged, merged }
}
