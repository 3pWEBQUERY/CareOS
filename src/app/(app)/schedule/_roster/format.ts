import type { Issue } from '@/lib/roster/evaluate'
import type { RDay, RPersonRow, RTypeOpt } from './types'

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string

/** Text einer Regelprüfungsmeldung (Raster, Statuszeile, Liste). */
export function issueText(t: T, i: Issue, ctx: { days: Map<string, RDay>; types: Map<string, RTypeOpt>; keyQual: string | null }) {
  const day = i.day ? ctx.days.get(i.day)?.label ?? i.day : ''
  const shift = i.shift ? ctx.types.get(i.shift)?.name ?? i.shift : ''
  const d = i.data ?? {}
  switch (i.code) {
    case 'rest': return t('roster.issue.rest', { hours: d.hours, min: d.min, prev: d.prev })
    case 'weekly': return t('roster.issue.weekly', { hours: d.hours, max: d.max, date: day })
    case 'under': case 'over': return t('roster.issue.' + i.code, { date: day, shift, n: d.n, target: d.target })
    case 'keyQual': return t('roster.issue.keyQual', { date: day, shift, qual: ctx.keyQual ?? '' })
    case 'hours': return t('roster.issue.hours', { diff: (Number(d.diff) > 0 ? '+' : '') + d.diff, soll: d.soll })
    case 'wish': return t('roster.issue.wish', { date: day })
    case 'notEligible': case 'notAllowed': return t('roster.issue.' + i.code, { shift })
    case 'groupMin': return t('roster.issue.groupMin', { date: day, shift, n: d.n, min: d.min, group: t('roster.groups.' + d.group) })
    default: return t('roster.issue.' + i.code, d)
  }
}

export const personName = (people: Map<string, RPersonRow>, id?: string) => (id ? people.get(id)?.name ?? '' : '')
