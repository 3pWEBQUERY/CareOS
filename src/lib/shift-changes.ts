/**
 * Änderungen an Verordnungen und Pflegeplanung für Übergabe und Home (PRD §11.1 «Medikamente», «Pflegeplanung»):
 * reine Logik ohne Datenbank – Server und Tests. Datenzugriff in `src/app/(app)/handover/changes.ts`.
 */

export type MedLike = {
  id: string
  residentId: string
  name: string
  form: string | null
  kind: string
  times: string[]
  doses: string[]
  prnDose: string | null
  createdAt: Date
  stoppedAt: Date | null
}

export type MedChange<M extends MedLike = MedLike> =
  | { type: 'changed'; residentId: string; at: Date; med: M; old: M }
  | { type: 'started'; residentId: string; at: Date; med: M }
  | { type: 'stopped'; residentId: string; at: Date; med: M }

/**
 * Ordnet neue und abgesetzte Verordnungen im Zeitfenster zu Änderungen: Eine Änderung legt eine neue Verordnung an und
 * setzt die alte im selben Moment ab (`replaces` aus dem Audit, sonst gleiche Person und ≤ 10 s Abstand).
 */
export function medChanges<M extends MedLike>(started: M[], stopped: M[], replaces: Map<string, string> = new Map()): MedChange<M>[] {
  const out: MedChange<M>[] = []
  const used = new Set<string>()
  for (const m of started) {
    const byAudit = replaces.get(m.id)
    const old =
      stopped.find((s) => s.id === byAudit && !used.has(s.id)) ??
      (byAudit ? undefined : stopped.find((s) => !used.has(s.id) && s.id !== m.id && s.residentId === m.residentId && s.stoppedAt && Math.abs(s.stoppedAt.getTime() - m.createdAt.getTime()) <= 10_000))
    if (old) {
      used.add(old.id)
      out.push({ type: 'changed', residentId: m.residentId, at: m.createdAt, med: m, old })
    } else out.push({ type: 'started', residentId: m.residentId, at: m.createdAt, med: m })
  }
  for (const s of stopped) if (!used.has(s.id) && s.stoppedAt && !started.some((m) => m.id === s.id)) out.push({ type: 'stopped', residentId: s.residentId, at: s.stoppedAt, med: s })
  // Neu angelegt und im Fenster bereits wieder abgesetzt: erscheint als «neu» und «abgesetzt»
  for (const s of stopped) if (!used.has(s.id) && s.stoppedAt && started.some((m) => m.id === s.id)) out.push({ type: 'stopped', residentId: s.residentId, at: s.stoppedAt, med: s })
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** Dosierschema kompakt: «08:00 1 Tbl. · 20:00 ½ Tbl.» bzw. Reserve-Dosis. */
export function schedule(m: Pick<MedLike, 'kind' | 'times' | 'doses' | 'prnDose' | 'form'>, doseText: (d: string, form: string | null) => string, prnLabel: string) {
  if (m.kind === 'prn') return `${prnLabel} ${doseText(m.prnDose ?? '', m.form)}`.trim()
  return m.times.map((t, i) => `${t} ${doseText(m.doses[i] ?? '', m.form)}`.trim()).join(' · ')
}

export type IvLike = { title: string; category: string; times: string[]; weekdays: number[]; instructions: string | null }

/** Unterschied zweier Pflegeplan-Versionen auf Ebene der Massnahmen (Titel + Kategorie). */
export function planDiff(prev: IvLike[], next: IvLike[]) {
  const key = (i: IvLike) => i.category.trim().toLowerCase() + '|' + i.title.trim().toLowerCase()
  const p = new Map(prev.map((i) => [key(i), i]))
  const n = new Map(next.map((i) => [key(i), i]))
  const same = (a: string[] | number[], b: string[] | number[]) => a.length === b.length && [...a].map(String).sort().join() === [...b].map(String).sort().join()
  return {
    added: next.filter((i) => !p.has(key(i))).map((i) => i.title),
    removed: prev.filter((i) => !n.has(key(i))).map((i) => i.title),
    changed: next
      .filter((i) => {
        const o = p.get(key(i))
        return o && (!same(o.times, i.times) || !same(o.weekdays, i.weekdays) || (o.instructions ?? '').trim() !== (i.instructions ?? '').trim())
      })
      .map((i) => i.title),
  }
}

/** Liste kürzen: «A, B, C» bzw. «A, B +3». */
export function listShort(items: string[], max = 3) {
  return items.length > max ? `${items.slice(0, max).join(', ')} +${items.length - max}` : items.join(', ')
}
