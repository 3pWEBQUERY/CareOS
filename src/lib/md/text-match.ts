/**
 * Freitext «Hausarzt» (Resident.physician, z. B. «Dr. med. P. Keller») einem Konto zuordnen. Reine Logik.
 * Nachname muss als Wort vorkommen; steht eine Initiale oder ein Vorname da, muss er zum Konto passen.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const TITLES = new Set(['dr', 'med', 'prof', 'pd', 'dipl', 'fmh', 'msc', 'phd', 'pract', 'dres'])

export function physicianTextMatches(text: string | null | undefined, u: { firstName: string; lastName: string }): boolean {
  if (!text) return false
  const words = norm(text).split(/[^a-z0-9]+/).filter(Boolean).filter((w) => !TITLES.has(w))
  const last = norm(u.lastName).split(/[\s-]+/).filter(Boolean)
  if (!last.length || !last.every((l) => words.includes(l))) return false
  const rest = words.filter((w) => !last.includes(w))
  if (!rest.length) return true
  const first = norm(u.firstName).split(/[\s-]+/).filter(Boolean)
  // Initialen oder Vornamen: jede Angabe muss zu einem Teil des Vornamens passen
  return rest.every((w) => (w.length === 1 ? first.some((f) => f.startsWith(w)) : first.includes(w)))
}
