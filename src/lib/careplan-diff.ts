/**
 * Unterschied eines eingereichten Pflegeplan-Entwurfs zur freigegebenen Version (Freigabeliste, PRD §9):
 * Pflegebereiche (neu, entfernt, inhaltlich geändert) und Massnahmen (über `planDiff`). Reine Logik – Server und Tests.
 */
import { planDiff, type IvLike } from './shift-changes'

export type AreaLike = {
  domain: string
  situation: string | null
  resources: string | null
  needs: string | null
  risks: string | null
  goal: string | null
  evaluation: string | null
  evaluateBy: Date | null
  interventions: IvLike[]
}

export type CarePlanChanges = {
  /** Keine freigegebene Version vorhanden: Erstfassung */
  first: boolean
  areasAdded: string[]
  areasRemoved: string[]
  areasChanged: string[]
  ivs: { added: string[]; removed: string[]; changed: string[] }
}

const TEXT = ['situation', 'resources', 'needs', 'risks', 'goal', 'evaluation'] as const
const norm = (s: string | null) => (s ?? '').trim().replace(/\s+/g, ' ')
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '')

/** `prev` = Bereiche der aktiven Version (nur aktive Massnahmen), `next` = Bereiche des Entwurfs. */
export function careplanChanges(prev: AreaLike[] | null, next: AreaLike[]): CarePlanChanges {
  if (!prev) {
    return { first: true, areasAdded: next.map((a) => a.domain), areasRemoved: [], areasChanged: [], ivs: { added: next.flatMap((a) => a.interventions.map((i) => i.title)), removed: [], changed: [] } }
  }
  const p = new Map(prev.map((a) => [a.domain, a]))
  const n = new Set(next.map((a) => a.domain))
  const ivDiff = (a: AreaLike, b: AreaLike) => {
    const d = planDiff(a.interventions, b.interventions)
    return d.added.length + d.removed.length + d.changed.length > 0
  }
  return {
    first: false,
    areasAdded: next.filter((a) => !p.has(a.domain)).map((a) => a.domain),
    areasRemoved: prev.filter((a) => !n.has(a.domain)).map((a) => a.domain),
    areasChanged: next
      .filter((a) => {
        const o = p.get(a.domain)
        return o && (TEXT.some((k) => norm(o[k]) !== norm(a[k])) || day(o.evaluateBy) !== day(a.evaluateBy) || ivDiff(o, a))
      })
      .map((a) => a.domain),
    ivs: planDiff(prev.flatMap((a) => a.interventions), next.flatMap((a) => a.interventions)),
  }
}

/** Gibt es überhaupt einen Unterschied? (Entwurf ohne Änderung gegenüber der aktiven Version) */
export const hasChanges = (c: CarePlanChanges) =>
  c.first || c.areasAdded.length + c.areasRemoved.length + c.areasChanged.length + c.ivs.added.length + c.ivs.removed.length + c.ivs.changed.length > 0
