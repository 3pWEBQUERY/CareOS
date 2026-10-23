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

/**
 * Speichern mit Konfliktprüfung: ohne Stand beim Öffnen (base) gilt die eigene Eingabe. Sonst werden nur selbst
 * geänderte Felder übernommen (andere bleiben auf dem aktuellen Stand); dasselbe Feld unterschiedlich geändert → conflicts.
 */
export function mergeEdit(base: Record<string, unknown> | null | undefined, current: Record<string, unknown>, mine: Record<string, unknown>, keys: readonly string[]) {
  if (!base) return { conflicts: [] as string[], data: Object.fromEntries(keys.map((k) => [k, mine[k]])) as Record<string, unknown>, changed: true }
  const tw = threeWay(base, snapshot(current, keys), snapshot(mine, keys), keys)
  const data = Object.fromEntries(keys.map((k) => [k, tw.mineChanged.includes(k) ? mine[k] : current[k]])) as Record<string, unknown>
  return { conflicts: tw.conflicts, data, changed: tw.mineChanged.length > 0 }
}

/** «base» aus einem Formularfeld (JSON) lesen; ungültig → null (dann ohne Prüfung). */
export function parseBase(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch { return null }
}
