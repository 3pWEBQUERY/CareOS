/**
 * Filter für die Combobox (lange Auswahllisten: Personen, Mitarbeitende, Medikamente, Räume).
 * Ohne Gross-/Kleinschreibung und Akzente («Bühler» findet «buhler», «Zoé» findet «zoe»), mehrere Wörter
 * müssen alle vorkommen (Label, Zusatz oder Stichwörter). Reihenfolge: Label beginnt mit der Eingabe,
 * dann Wortanfang, dann irgendwo – innerhalb gleicher Stufe bleibt die ursprüngliche Reihenfolge.
 */
export type ComboOption = {
  value: string
  label: string
  /** Zusatz rechts/unter dem Label (z. B. Zimmer, Funktion) – wird mitdurchsucht. */
  hint?: string
  /** Gruppenüberschrift (z. B. Wohngruppe). Optionen mit gleicher Gruppe sollten zusammen stehen. */
  group?: string
  /** Weitere Suchbegriffe, nicht angezeigt (z. B. Initialen, Personalnummer). */
  keywords?: string
  disabled?: boolean
}

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().trim()

export function filterOptions<T extends ComboOption>(options: T[], query: string): T[] {
  const q = normalize(query)
  if (!q) return options
  const words = q.split(/\s+/).filter(Boolean)
  const scored: { o: T; s: number; i: number }[] = []
  options.forEach((o, i) => {
    const label = normalize(o.label)
    const hay = label + ' ' + normalize(o.hint ?? '') + ' ' + normalize(o.keywords ?? '') + ' ' + normalize(o.group ?? '')
    if (!words.every((w) => hay.includes(w))) return
    const s = label.startsWith(q) ? 0 : words.every((w) => new RegExp('(^|[^a-z0-9])' + escapeRe(w)).test(hay)) ? 1 : 2
    scored.push({ o, s, i })
  })
  return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.o)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Gruppiert für die Anzeige; die Reihenfolge der Gruppen folgt dem ersten Vorkommen. */
export function groupOptions<T extends ComboOption>(options: T[]): { group: string | undefined; items: T[] }[] {
  const out: { group: string | undefined; items: T[] }[] = []
  for (const o of options) {
    const g = out.find((x) => x.group === o.group)
    if (g) g.items.push(o)
    else out.push({ group: o.group, items: [o] })
  }
  return out
}

/** Nächste aktivierbare Option (Pfeiltasten, mit Umlauf); -1 wenn keine. */
export function nextEnabled(options: ComboOption[], from: number, dir: 1 | -1): number {
  const n = options.length
  if (!n) return -1
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n
    if (!options[i].disabled) return i
  }
  return -1
}
