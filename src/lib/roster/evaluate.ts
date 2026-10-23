import { cellKey, dailySoll, isNight, isWeekend, isoMonday, restHours, round1, shiftDay, shiftHours, sollHours, weekday, type Grid, type RProblem, type RType } from './model'

/**
 * Regelprüfung eines Plans. Fehler (`error`) verletzen eine harte Regel und werden von der automatischen Planung
 * nie erzeugt; Warnungen (`warn`) und Hinweise (`info`) betreffen Besetzung, Qualifikation, Wünsche und Stunden.
 */
export type IssueCode =
  | 'absent' | 'rest' | 'consecutive' | 'nights' | 'weekly'
  | 'pending' | 'under' | 'keyQual' | 'hours' | 'weekends'
  | 'over' | 'wish'
export type Issue = {
  code: IssueCode
  severity: 'error' | 'warn' | 'info'
  user?: string
  day?: string
  shift?: string
  data?: Record<string, string | number>
}

export type PersonStats = { soll: number; ist: number; diff: number; shifts: number; nights: number; weekends: number; freeWeekends: number }
export type Coverage = Record<string, Record<string, { n: number; target: number; key: boolean }>>

export const SEVERITY: Record<IssueCode, Issue['severity']> = {
  absent: 'error', rest: 'error', consecutive: 'error', nights: 'error', weekly: 'error',
  pending: 'warn', under: 'warn', keyQual: 'warn', hours: 'warn', weekends: 'warn',
  over: 'info', wish: 'info',
}

/** Wert einer Zelle: Planraster, sonst gesperrter Wert (Kontext, andere Bereiche). */
export const cellOf = (p: RProblem, g: Grid, userId: string, day: string) => {
  const k = cellKey(userId, day)
  return k in p.locked ? p.locked[k] : (g[k] ?? null)
}

export const typeMap = (p: RProblem) => new Map(p.types.map((t) => [t.code, t]))

/** Toleranz für Abweichung vom Soll: eine Schicht bzw. 10 %. */
export const hoursTolerance = (soll: number) => Math.max(8, soll * 0.1)

/** Harte Regeln für eine einzelne Zelle (Person, Tag) im aktuellen Plan. */
export function cellViolations(p: RProblem, g: Grid, types: Map<string, RType>, userId: string, day: string): Issue[] {
  const code = cellOf(p, g, userId, day)
  if (!code) return []
  const t = types.get(code)
  if (!t) return []
  const out: Issue[] = []
  const k = cellKey(userId, day)
  const r = p.rules
  if (p.absent[k] === 'approved') out.push({ code: 'absent', severity: 'error', user: userId, day, shift: code })
  else if (p.absent[k] === 'requested') out.push({ code: 'pending', severity: 'warn', user: userId, day, shift: code })

  const prev = cellOf(p, g, userId, shiftDay(day, -1))
  const pt = prev ? types.get(prev) : undefined
  if (pt) {
    const rest = restHours(pt, t)
    if (rest < r.minRestHours) out.push({ code: 'rest', severity: 'error', user: userId, day, shift: code, data: { hours: round1(Math.max(0, rest)), min: r.minRestHours, prev: prev! } })
  }

  // Serie: Arbeitstage am Stück, die diesen Tag enthalten (nur am letzten Tag einer zu langen Serie melden)
  const run = (pred: (c: string | null) => boolean) => {
    let back = 0
    while (back < 20 && pred(cellOf(p, g, userId, shiftDay(day, -(back + 1))))) back++
    return back + 1
  }
  const worked = (c: string | null) => !!c
  const night = (c: string | null) => !!c && !!types.get(c) && isNight(types.get(c)!)
  const days = run(worked)
  if (days > r.maxConsecutiveDays) out.push({ code: 'consecutive', severity: 'error', user: userId, day, shift: code, data: { n: days, max: r.maxConsecutiveDays } })
  if (isNight(t)) {
    const nights = run(night)
    if (nights > r.maxConsecutiveNights) out.push({ code: 'nights', severity: 'error', user: userId, day, shift: code, data: { n: nights, max: r.maxConsecutiveNights } })
  }
  return out
}

/** Stunden einer ISO-Woche (Mo–So) einer Person, inkl. Kontexttage und Dienste in anderen Bereichen. */
export function weekHours(p: RProblem, g: Grid, types: Map<string, RType>, userId: string, monday: string) {
  let h = 0
  for (let i = 0; i < 7; i++) {
    const c = cellOf(p, g, userId, shiftDay(monday, i))
    const t = c ? types.get(c) : undefined
    if (t) h += shiftHours(t)
  }
  return h
}

/** Freie Wochenenden im Monat: Samstag und Sonntag frei, kein Nachtdienst in der Nacht auf Samstag. */
export function freeWeekends(p: RProblem, g: Grid, types: Map<string, RType>, userId: string) {
  let free = 0
  let total = 0
  for (const d of p.days) {
    if (weekday(d) !== 6 || !p.days.includes(shiftDay(d, 1))) continue
    total++
    const fri = cellOf(p, g, userId, shiftDay(d, -1))
    const friNight = !!fri && !!types.get(fri) && isNight(types.get(fri)!)
    if (!cellOf(p, g, userId, d) && !cellOf(p, g, userId, shiftDay(d, 1)) && !friNight) free++
  }
  return { free, total }
}

export function personStats(p: RProblem, g: Grid, types: Map<string, RType>, person: { id: string; pct: number }): PersonStats {
  const soll = sollHours(p.rules, person.pct, p.days)
  const daily = dailySoll(p.rules, person.pct)
  let ist = 0
  let shifts = 0
  let nights = 0
  let weekends = 0
  for (const d of p.days) {
    const k = cellKey(person.id, d)
    const c = cellOf(p, g, person.id, d)
    const t = c ? types.get(c) : undefined
    if (t) {
      ist += shiftHours(t)
      shifts++
      if (isNight(t)) nights++
      if (isWeekend(d)) weekends++
    } else if (p.credit[k] && !isWeekend(d)) ist += daily
  }
  const fw = freeWeekends(p, g, types, person.id)
  return { soll: round1(soll), ist: round1(ist), diff: round1(ist - soll), shifts, nights, weekends, freeWeekends: fw.free }
}

/** Besetzung je Tag und Dienst (ohne Dienste in anderen Bereichen und ohne genehmigt Abwesende). */
export function coverage(p: RProblem, g: Grid): Coverage {
  const keyOf = new Map(p.people.map((x) => [x.id, x.key]))
  const out: Coverage = {}
  for (const d of p.days) {
    const row: Coverage[string] = {}
    for (const t of p.types) row[t.code] = { n: 0, target: p.targets[t.code] ?? 0, key: false }
    for (const person of p.people) {
      const k = cellKey(person.id, d)
      if (p.foreign[k] || p.absent[k] === 'approved') continue
      const c = cellOf(p, g, person.id, d)
      if (!c || !row[c]) continue
      row[c].n++
      if (keyOf.get(person.id)) row[c].key = true
    }
    out[d] = row
  }
  return out
}

export type Evaluation = {
  issues: Issue[]
  people: Record<string, PersonStats>
  coverage: Coverage
  wishes: { total: number; met: number }
  /** Anteil der Soll-Plätze, die besetzt sind (0–100) */
  coverageRate: number
  hasKeyQual: boolean
}

export function evaluate(p: RProblem, g: Grid): Evaluation {
  const types = typeMap(p)
  const issues: Issue[] = []
  const r = p.rules
  for (const person of p.people) {
    for (const d of p.days) issues.push(...cellViolations(p, g, types, person.id, d))
    const mondays = [...new Set(p.days.map(isoMonday))]
    for (const m of mondays) {
      const h = weekHours(p, g, types, person.id, m)
      if (h > r.maxWeeklyHours) issues.push({ code: 'weekly', severity: 'error', user: person.id, day: m, data: { hours: round1(h), max: r.maxWeeklyHours } })
    }
  }
  const people: Record<string, PersonStats> = {}
  for (const person of p.people) {
    const s = personStats(p, g, types, person)
    people[person.id] = s
    if (Math.abs(s.diff) > hoursTolerance(s.soll) && s.soll > 0) issues.push({ code: 'hours', severity: 'warn', user: person.id, data: { diff: s.diff, soll: s.soll } })
    const fw = freeWeekends(p, g, types, person.id)
    if (fw.total >= r.minFreeWeekends && fw.free < r.minFreeWeekends) issues.push({ code: 'weekends', severity: 'warn', user: person.id, data: { n: fw.free, min: r.minFreeWeekends } })
  }
  const cov = coverage(p, g)
  const hasKeyQual = p.people.some((x) => x.key)
  let slots = 0
  let filled = 0
  for (const d of p.days)
    for (const t of p.types) {
      const c = cov[d][t.code]
      slots += c.target
      filled += Math.min(c.n, c.target)
      if (c.n < c.target) issues.push({ code: 'under', severity: 'warn', day: d, shift: t.code, data: { n: c.n, target: c.target } })
      else if (c.n > c.target) issues.push({ code: 'over', severity: 'info', day: d, shift: t.code, data: { n: c.n, target: c.target } })
      if (hasKeyQual && c.target > 0 && c.n > 0 && !c.key) issues.push({ code: 'keyQual', severity: 'warn', day: d, shift: t.code })
    }
  let total = 0
  let met = 0
  for (const [k, w] of Object.entries(p.wishes)) {
    const [userId, d] = k.split('|')
    if (!p.days.includes(d) || !p.people.some((x) => x.id === userId)) continue
    total++
    const c = cellOf(p, g, userId, d)
    const ok = w.kind === 'off' ? !c : c === w.code
    if (ok) met++
    else issues.push({ code: 'wish', severity: 'info', user: userId, day: d, data: { wish: w.kind === 'off' ? '' : w.code } })
  }
  return { issues, people, coverage: cov, wishes: { total, met }, coverageRate: slots ? Math.round((filled / slots) * 100) : 100, hasKeyQual }
}
