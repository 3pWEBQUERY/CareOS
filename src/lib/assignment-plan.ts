/**
 * Bewohnerzuordnung pro Dienst (PRD §7, §70): reine Logik ohne Datenbank – Server, Client und Tests.
 * Datenzugriff in `src/lib/assignment.ts`.
 */

export type Pair = { residentId: string; userId: string }
export type HistoryPair = Pair & { at: number }
export type SuggestInput = {
  /** Bewohnende in Zimmerreihenfolge; primaryNurseId = Bezugsperson */
  residents: { id: string; primaryNurseId?: string | null }[]
  /** Personen im Dienst dieser Schicht (Dienstplan) */
  staff: string[]
  /** Zuteilungen der letzten Tage im Bereich (beliebige Schicht), `at` = Schichtbeginn */
  history: HistoryPair[]
}
export type Suggestion = { pairs: Pair[]; source: Record<string, 'history' | 'primary' | 'balance'> }

/**
 * Vorschlag für die Zuteilung (Kontinuität vor Gleichverteilung):
 * 1. wer die Person zuletzt betreut hat und heute im Dienst ist (Vortag/letzte Schicht),
 * 2. sonst die Bezugsperson, falls im Dienst,
 * 3. Rest gleichmässig, benachbarte Zimmer zusammenhängend bei derselben Person.
 * Niemand erhält mehr als ⌈Bewohnende / Personen⌉, damit eine Einzelbesetzung von gestern nicht alles an eine Person bindet.
 */
export function suggestAssignments({ residents, staff, history }: SuggestInput): Suggestion {
  const pairs: Pair[] = []
  const source: Suggestion['source'] = {}
  if (!staff.length || !residents.length) return { pairs, source }
  const cap = Math.ceil(residents.length / staff.length)
  const load = new Map(staff.map((s) => [s, 0]))
  const owner = new Map<string, string>()
  const onDuty = new Set(staff)
  const take = (rid: string, uid: string, why: 'history' | 'primary' | 'balance') => {
    owner.set(rid, uid)
    load.set(uid, (load.get(uid) ?? 0) + 1)
    source[rid] = why
  }
  const newestFirst = [...history].sort((a, b) => b.at - a.at)
  for (const r of residents) {
    const prev = newestFirst.find((h) => h.residentId === r.id && onDuty.has(h.userId) && (load.get(h.userId) ?? 0) < cap)
    if (prev) take(r.id, prev.userId, 'history')
  }
  for (const r of residents) {
    if (owner.has(r.id)) continue
    const p = r.primaryNurseId
    if (p && onDuty.has(p) && (load.get(p) ?? 0) < cap) take(r.id, p, 'primary')
  }
  // Rest: zuerst festlegen, wie viele jede Person noch erhält (immer an die mit der geringsten Zahl),
  // dann in Zimmerreihenfolge zusammenhängend vergeben – benachbarte Zimmer bleiben bei derselben Person.
  const rest = residents.filter((r) => !owner.has(r.id))
  const inc = new Map(staff.map((s) => [s, 0]))
  const final = new Map(load)
  for (let i = 0; i < rest.length; i++) {
    const s = [...staff].sort((a, b) => (final.get(a) ?? 0) - (final.get(b) ?? 0))[0]
    final.set(s, (final.get(s) ?? 0) + 1)
    inc.set(s, (inc.get(s) ?? 0) + 1)
  }
  let k = 0
  for (const s of [...staff].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))) {
    for (let n = 0; n < (inc.get(s) ?? 0); n++) take(rest[k++].id, s, 'balance')
  }
  for (const r of residents) {
    const u = owner.get(r.id)
    if (u) pairs.push({ residentId: r.id, userId: u })
  }
  return { pairs, source }
}

/** Unterschied zwischen bestehender und gewünschter Zuteilung (für Speichern und Audit). */
export function diffPairs(before: Pair[], after: Pair[]) {
  const key = (p: Pair) => p.residentId + ':' + p.userId
  const a = new Set(after.map(key))
  const b = new Set(before.map(key))
  return {
    added: after.filter((p) => !b.has(key(p))),
    removed: before.filter((p) => !a.has(key(p))),
  }
}

/** Doppelte Paare entfernen, nur bekannte Personen/Bewohnende zulassen. */
export function cleanPairs(pairs: Pair[], residentIds: Iterable<string>, userIds: Iterable<string>) {
  const rs = new Set(residentIds)
  const us = new Set(userIds)
  const seen = new Set<string>()
  return pairs.filter((p) => {
    const k = p.residentId + ':' + p.userId
    if (!rs.has(p.residentId) || !us.has(p.userId) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Zimmer kompakt als Bereiche: 201, 202, 203, 205 → «201–203, 205». */
export function roomRanges(rooms: string[]) {
  const sorted = [...rooms].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const out: string[] = []
  let start = 0
  for (let i = 1; i <= sorted.length; i++) {
    const prev = Number(sorted[i - 1])
    const cur = Number(sorted[i])
    if (i < sorted.length && Number.isInteger(prev) && Number.isInteger(cur) && cur === prev + 1) continue
    out.push(i - 1 > start ? `${sorted[start]}–${sorted[i - 1]}` : sorted[start])
    start = i
  }
  return out.join(', ')
}
