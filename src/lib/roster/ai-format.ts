import { z } from 'zod'
import { cellKey, isNight, round1, shiftHours, sollHours, weekday, type Grid, type RProblem } from './model'
import { editableKeys, type PersonConstraint } from './solver'

/**
 * Prompt und Auswertung der KI-Dienstplanung – rein, ohne Server-Abhängigkeiten (testbar). Aufruf: `./ai.ts`.
 */

const LANG = { de: 'Deutsch', fr: 'Französisch', it: 'Italienisch', en: 'Englisch' } as const
type Locale = keyof typeof LANG

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function ranges(nums: number[]) {
  const out: string[] = []
  for (let i = 0; i < nums.length; i++) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]))
    i = j
  }
  return out.join(', ')
}

export function buildPrompt(p: RProblem, current: Grid, mode: 'fill' | 'replace', monthLabel: string, instructions: string, locale: Locale) {
  const n = p.days.length
  const editable = editableKeys(p, current, mode)
  const r = p.rules
  const alias = new Map(p.people.map((x, i) => [x.id, 'P' + (i + 1)]))
  const lines: string[] = []
  lines.push(`Monat: ${monthLabel}, Tage 1–${n}.`)
  lines.push('Wochentage: ' + p.days.map((d, i) => `${i + 1} ${WD[weekday(d)]}`).join(', '))
  lines.push('', 'Dienste (Code, Zeit, bezahlte Stunden):')
  for (const t of p.types) lines.push(`${t.code} ${t.start}–${t.end} ${round1(shiftHours(t))} h${isNight(t) ? ' (Nacht)' : ''}`)
  lines.push('', 'Soll-Besetzung pro Tag: ' + p.types.map((t) => `${t.code} ${p.targets[t.code] ?? 0}`).join(', '))
  lines.push('', 'Personen (Kürzel | Name | Pensum | Soll-Stunden im Monat | Schlüsselqualifikation *):')
  for (const x of p.people) {
    lines.push(`${alias.get(x.id)} | ${x.name} | ${x.pct} % | ${round1(sollHours(r, x.pct, p.days))} h${x.key ? ' | *' : ''}`)
    const fixed: string[] = []
    const locked: number[] = []
    const away: number[] = []
    const off: number[] = []
    const want: string[] = []
    p.days.forEach((d, i) => {
      const k = cellKey(x.id, d)
      if (p.absent[k]) away.push(i + 1)
      else if (!editable.has(k)) {
        const v = k in p.locked ? p.locked[k] : current[k]
        if (v) fixed.push(`${i + 1} ${v}`)
        else locked.push(i + 1)
      }
      const w = p.wishes[k]
      if (w?.kind === 'off') off.push(i + 1)
      else if (w?.kind === 'shift') want.push(`${i + 1} ${w.code}`)
    })
    if (fixed.length) lines.push(`  fix: ${fixed.join(', ')}`)
    if (locked.length) lines.push(`  fix frei: ${ranges(locked)}`)
    if (away.length) lines.push(`  abwesend: ${ranges(away)}`)
    if (off.length || want.length) lines.push(`  Wünsche: ${[off.length ? 'frei ' + ranges(off) : '', want.length ? 'Dienst ' + want.join(', ') : ''].filter(Boolean).join(' · ')}`)
    const prev = p.before.slice(-4).map((d, i, arr) => {
      const v = p.locked[cellKey(x.id, d)]
      return v ? `${i - arr.length} ${v}` : ''
    }).filter(Boolean)
    if (prev.length) lines.push(`  Vormonat (Tage vor dem 1.): ${prev.join(', ')}`)
  }
  lines.push('', 'Anweisungen der Leitung:', instructions.trim() ? `<anweisungen>\n${instructions.trim().slice(0, 2000)}\n</anweisungen>` : '(keine)')

  const system = `Du erstellst Monats-Dienstpläne für eine Schweizer Pflegeeinrichtung. Ziel ist ein Plan, den die Leitung ohne Nacharbeit freigeben kann.

Harte Regeln, nie verletzen:
- Höchstens ein Dienst pro Person und Tag.
- Kein Dienst an Abwesenheitstagen. Fixe Einträge («fix», «fix frei») unverändert übernehmen.
- Ruhezeit zwischen zwei Diensten mindestens ${r.minRestHours} Stunden: also nie Spätdienst und am Folgetag Frühdienst, nie Nachtdienst und am Folgetag ein Tagdienst. Das gilt auch für die Tage aus dem Vormonat.
- Höchstens ${r.maxConsecutiveDays} Arbeitstage am Stück, höchstens ${r.maxConsecutiveNights} Nachtdienste am Stück, höchstens ${r.maxWeeklyHours} Stunden pro Kalenderwoche (Mo–So).
- Einschränkungen aus den Anweisungen der Leitung gehen Wünschen vor.

Ziele, in dieser Reihenfolge:
1. Soll-Besetzung jedes Dienstes an jedem Tag genau erreichen, nicht überschreiten.
2. In jedem besetzten Dienst mindestens eine Person mit Schlüsselqualifikation (*), falls möglich.
3. Geplante Stunden je Person nahe an ihren Soll-Stunden (Pensum). Teilzeit nicht überplanen.
4. Wünsche erfüllen.
5. Gesunde Rhythmen: Nachtdienste in Blöcken von 2–4 Nächten, danach mindestens 2 freie Tage; Wechsel vorwärts (Früh → Spät → Nacht); keine einzelnen Arbeitstage zwischen freien Tagen, wo vermeidbar.
6. Wochenenden fair verteilen, jede Person mindestens ${r.minFreeWeekends} freies Wochenende (Samstag und Sonntag).

Ausgabe:
- plan: für jede Person genau ${n} Einträge für Tag 1 bis ${n}, jeweils ein Dienstcode oder "" für frei.
- constraints: nur Einschränkungen, die ausdrücklich in den Anweisungen der Leitung stehen, je Person: allowed = erlaubte Dienstcodes (leer = alle), offDays = Tage, an denen die Person nicht arbeiten soll. Ohne solche Anweisungen eine leere Liste.
- notes: höchstens 5 kurze, konkrete Sätze auf ${LANG[locale]} zu Zielkonflikten, die die Leitung kennen muss (z. B. an welchen Tagen die Besetzung nicht reicht und warum, welche Wünsche nicht erfüllbar sind). Personen mit Namen nennen, Tage als Datum. Keine Wiederholung der Regeln, keine Einleitung, kein Lob.`
  return { system, user: lines.join('\n'), alias }
}

export function aiSchema(codes: string[]) {
  const Code = z.enum(['', ...codes] as [string, ...string[]])
  return z.object({
    plan: z.array(z.object({ person: z.string(), shifts: z.array(Code) })),
    constraints: z.array(z.object({ person: z.string(), allowed: z.array(Code), offDays: z.array(z.number().int()) })),
    notes: z.array(z.string()),
  })
}

/** Antwort der KI in Startplan, Einschränkungen und Hinweise übersetzen (Kürzel → Personen, Tagnummern → Daten). */
export function readAiResult(p: RProblem, alias: Map<string, string>, parsed: z.infer<ReturnType<typeof aiSchema>>) {
  const codes = p.types.map((t) => t.code)
  const byAlias = new Map([...alias].map(([id, a]) => [a, id]))
  const seed: Grid = {}
  for (const row of parsed.plan) {
    const id = byAlias.get(row.person.trim())
    if (!id) continue
    p.days.forEach((d, i) => {
      const v = row.shifts[i]
      if (v) seed[cellKey(id, d)] = v
    })
  }
  const constraints: Record<string, PersonConstraint> = {}
  for (const c of parsed.constraints) {
    const id = byAlias.get(c.person.trim())
    if (!id) continue
    const allowed = c.allowed.filter((x) => x && codes.includes(x))
    const offDays = c.offDays.filter((x) => x >= 1 && x <= p.days.length).map((x) => p.days[x - 1])
    if (allowed.length || offDays.length) constraints[id] = { ...(allowed.length ? { allowed } : {}), ...(offDays.length ? { offDays } : {}) }
  }
  // Kürzel in den Hinweisen durch Namen ersetzen (falls die KI sie verwendet)
  const names = new Map(p.people.map((x) => [alias.get(x.id)!, x.name]))
  const notes = parsed.notes.slice(0, 5).map((s) => s.replace(/\bP(\d{1,3})\b/g, (m) => names.get(m) ?? m).trim()).filter(Boolean)
  return { seed, constraints, notes }
}
