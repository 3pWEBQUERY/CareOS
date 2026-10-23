import { cellKey, dailySoll, isNight, isWeekend, isoMonday, restHours, shiftDay, shiftHours, sollHours, weekday, type Cell, type Grid, type RProblem, type RType } from './model'
import { cellOf, freeWeekends, hoursTolerance, typeMap, weekHours } from './evaluate'

/**
 * Automatische Monatsplanung: übernimmt einen Startplan (z. B. den Vorschlag der KI), entfernt Einträge, die eine
 * harte Regel verletzen, und füllt fehlende Soll-Besetzung greedy nach Stundenbedarf, Wünschen, Qualifikation und
 * Fairness. Gesperrte Zellen und – im Modus `fill` – bestehende Dienste bleiben unverändert.
 */

export type PersonConstraint = { allowed?: string[]; offDays?: string[] }
export type PlanOptions = {
  mode: 'fill' | 'replace'
  /** Startbelegung für änderbare Zellen (KI-Vorschlag, Vormonat) */
  seed?: Grid
  /** Einschränkungen je Person (aus den Anweisungen der Leitung) */
  constraints?: Record<string, PersonConstraint>
  /** Für reproduzierbare Varianten */
  salt?: number
}
export type Repair = { user: string; day: string; from: Cell; to: Cell; reason: 'invalid' | 'absent' | 'constraint' | 'rule' | 'over' | 'fill' }
export type PlanResult = { grid: Grid; repairs: Repair[] }

/** Zellen, die die Planung ändern darf. */
export function editableKeys(p: RProblem, current: Grid, mode: PlanOptions['mode']) {
  const out = new Set<string>()
  for (const person of p.people)
    for (const d of p.days) {
      const k = cellKey(person.id, d)
      if (k in p.locked) continue
      if (mode === 'fill' && current[k]) continue
      out.add(k)
    }
  return out
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** Würde ein Dienst `code` am Tag `day` eine harte Regel verletzen? */
export function feasible(p: RProblem, g: Grid, types: Map<string, RType>, userId: string, day: string, code: string, constraint?: PersonConstraint) {
  const t = types.get(code)
  if (!t) return false
  const k = cellKey(userId, day)
  if (p.absent[k]) return false
  if (constraint?.allowed?.length && !constraint.allowed.includes(code)) return false
  if (constraint?.offDays?.includes(day)) return false
  const r = p.rules
  const prev = cellOf(p, g, userId, shiftDay(day, -1))
  const next = cellOf(p, g, userId, shiftDay(day, 1))
  const pt = prev ? types.get(prev) : undefined
  const nt = next ? types.get(next) : undefined
  if (pt && restHours(pt, t) < r.minRestHours) return false
  if (nt && restHours(t, nt) < r.minRestHours) return false
  const span = (pred: (c: Cell) => boolean) => {
    let n = 1
    for (let i = 1; i < 20 && pred(cellOf(p, g, userId, shiftDay(day, -i))); i++) n++
    for (let i = 1; i < 20 && pred(cellOf(p, g, userId, shiftDay(day, i))); i++) n++
    return n
  }
  if (span((c) => !!c) > r.maxConsecutiveDays) return false
  if (isNight(t) && span((c) => !!c && !!types.get(c) && isNight(types.get(c)!)) > r.maxConsecutiveNights) return false
  const before = cellOf(p, g, userId, day)
  const bt = before ? types.get(before) : undefined
  const wh = weekHours(p, g, types, userId, isoMonday(day)) - (bt ? shiftHours(bt) : 0) + shiftHours(t)
  if (wh > r.maxWeeklyHours) return false
  return true
}

export function plan(p: RProblem, current: Grid, opts: PlanOptions): PlanResult {
  const types = typeMap(p)
  const editable = editableKeys(p, current, opts.mode)
  const repairs: Repair[] = []
  const g: Grid = {}
  const cons = opts.constraints ?? {}

  // 1. Startbelegung: feste Zellen übernehmen, änderbare aus dem Startplan (ungültige Einträge verwerfen)
  for (const person of p.people)
    for (const d of p.days) {
      const k = cellKey(person.id, d)
      if (!editable.has(k)) {
        if (!(k in p.locked) && current[k]) g[k] = current[k]
        continue
      }
      const v = opts.seed ? (opts.seed[k] ?? null) : opts.mode === 'replace' ? null : (current[k] ?? null)
      if (!v) continue
      if (!types.has(v)) { repairs.push({ user: person.id, day: d, from: v, to: null, reason: 'invalid' }); continue }
      if (p.absent[k]) { repairs.push({ user: person.id, day: d, from: v, to: null, reason: 'absent' }); continue }
      const c = cons[person.id]
      if ((c?.allowed?.length && !c.allowed.includes(v)) || c?.offDays?.includes(d)) { repairs.push({ user: person.id, day: d, from: v, to: null, reason: 'constraint' }); continue }
      g[k] = v
    }

  // 2. Harte Regeln: verletzende änderbare Einträge entfernen (bis stabil)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const person of p.people)
      for (const d of p.days) {
        const k = cellKey(person.id, d)
        const v = g[k]
        if (!v || !editable.has(k)) continue
        delete g[k]
        if (feasible(p, g, types, person.id, d, v)) g[k] = v
        else { repairs.push({ user: person.id, day: d, from: v, to: null, reason: 'rule' }); changed = true }
      }
    if (!changed) break
  }

  // Stundenstand je Person
  const soll = new Map(p.people.map((x) => [x.id, sollHours(p.rules, x.pct, p.days)]))
  const ist = new Map<string, number>()
  const weekendsWorked = new Map<string, number>()
  for (const person of p.people) {
    let h = 0
    let we = 0
    for (const d of p.days) {
      const c = cellOf(p, g, person.id, d)
      const t = c ? types.get(c) : undefined
      if (t) { h += shiftHours(t); if (weekday(d) === 6) we++ }
      else if (p.credit[cellKey(person.id, d)] && !isWeekend(d)) h += dailySoll(p.rules, person.pct)
    }
    ist.set(person.id, h)
    weekendsWorked.set(person.id, we)
  }
  const countOn = (d: string, code: string) => p.people.filter((x) => {
    const k = cellKey(x.id, d)
    return !p.foreign[k] && p.absent[k] !== 'approved' && cellOf(p, g, x.id, d) === code
  })

  // 3. Überbesetzung aus änderbaren Einträgen abbauen (wer am meisten über Soll liegt, zuerst)
  for (const d of p.days)
    for (const t of p.types) {
      const target = p.targets[t.code] ?? 0
      let on = countOn(d, t.code)
      while (on.length > target) {
        const removable = on.filter((x) => editable.has(cellKey(x.id, d)))
        if (!removable.length) break
        removable.sort((a, b) => (ist.get(b.id)! - soll.get(b.id)!) - (ist.get(a.id)! - soll.get(a.id)!))
        const x = removable[0]
        delete g[cellKey(x.id, d)]
        ist.set(x.id, ist.get(x.id)! - shiftHours(t))
        repairs.push({ user: x.id, day: d, from: t.code, to: null, reason: 'over' })
        on = countOn(d, t.code)
      }
    }

  // 4. Fehlende Besetzung füllen: Nachtdienste zuerst (wenigste Kandidaten), dann nach Beginnzeit
  const order = [...p.types].sort((a, b) => Number(isNight(b)) - Number(isNight(a)) || a.start.localeCompare(b.start))
  const keyNeeded = p.people.some((x) => x.key)
  for (const d of p.days)
    for (const t of order) {
      const target = p.targets[t.code] ?? 0
      const h = shiftHours(t)
      for (let guard = 0; guard < 50; guard++) {
        const on = countOn(d, t.code)
        if (on.length >= target) break
        const hasKey = on.some((x) => x.key)
        const left = target - on.length
        let best: { id: string; score: number } | null = null
        for (const person of p.people) {
          const k = cellKey(person.id, d)
          if (!editable.has(k) || g[k]) continue
          if (!feasible(p, g, types, person.id, d, t.code, cons[person.id])) continue
          const s = soll.get(person.id)!
          const cur = ist.get(person.id)!
          let score = s > 0 ? (2 * (s - cur)) / s : -1
          if (cur + h > s + hoursTolerance(s) / 2) score -= 2
          const w = p.wishes[k]
          if (w?.kind === 'shift') score += w.code === t.code ? 3 : -1
          if (w?.kind === 'off') score -= 5
          if (keyNeeded && !hasKey) score += person.key ? 2.5 : left === 1 ? -3 : 0
          const prev = cellOf(p, g, person.id, shiftDay(d, -1))
          if (prev === t.code) score += isNight(t) ? 0.6 : 0.15
          else if (prev && isNight(types.get(prev)!) !== isNight(t)) score -= 0.4
          let run = 0
          while (run < 10 && cellOf(p, g, person.id, shiftDay(d, -(run + 1)))) run++
          if (run >= 4) score -= 0.25 * (run - 3)
          if (isWeekend(d)) {
            score -= 0.35 * (weekendsWorked.get(person.id) ?? 0)
            g[k] = t.code
            const fw = freeWeekends(p, g, types, person.id)
            delete g[k]
            if (fw.total >= p.rules.minFreeWeekends && fw.free < p.rules.minFreeWeekends) score -= 2
          }
          score += hash(`${opts.salt ?? 0}|${person.id}|${d}|${t.code}`) * 0.05
          if (!best || score > best.score) best = { id: person.id, score }
        }
        if (!best) break
        g[cellKey(best.id, d)] = t.code
        ist.set(best.id, ist.get(best.id)! + h)
        if (weekday(d) === 6) weekendsWorked.set(best.id, (weekendsWorked.get(best.id) ?? 0) + 1)
        repairs.push({ user: best.id, day: d, from: null, to: t.code, reason: 'fill' })
      }
    }

  return { grid: g, repairs }
}

/** Unterschied zweier Pläne: geänderte Zellen (nur änderbare Tage des Monats). */
export function diffGrids(p: RProblem, from: Grid, to: Grid) {
  const out: { user: string; day: string; from: Cell; to: Cell }[] = []
  for (const person of p.people)
    for (const d of p.days) {
      const k = cellKey(person.id, d)
      if (k in p.locked) continue
      const a = from[k] ?? null
      const b = to[k] ?? null
      if (a !== b) out.push({ user: person.id, day: d, from: a, to: b })
    }
  return out
}
