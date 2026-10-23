import type { Grid, RProblem, RRules } from '@/lib/roster/model'

/** Daten für das Monatsraster (serialisierbar, vom Server vorbereitet). */
export type RDay = { key: string; dom: number; wd: string; label: string; weekend: boolean; past: boolean; today: boolean }
export type RTypeOpt = { id: string; code: string; name: string; start: string; end: string; hours: number; night: boolean }
export type RPersonRow = { id: string; name: string; short: string; qual: string; job: string; pct: number; key: boolean }
export type RShiftMeta = { id: string; typeId: string; status: string; note: string | null; req: string | null; unit: string | null }
export type RProposalView = {
  id: string
  status: 'running' | 'ready' | 'failed'
  source: 'ai' | 'auto' | 'copy'
  mode: 'fill' | 'replace'
  cells: { u: string; d: string; c: string | null }[]
  summary: {
    coverageRate: number
    errors: number
    warnings: number
    wishes: { met: number; total: number }
    changes: number
    repairs: Record<string, number>
    notes?: string[]
    constraints?: { name: string; allowed?: string[]; offDays?: string[] }[]
    before: { coverageRate: number; errors: number }
  } | null
  error: string | null
  model: string | null
}

export type RosterProps = {
  unitId: string
  month: string
  monthLabel: string
  days: RDay[]
  types: RTypeOpt[]
  people: RPersonRow[]
  problem: RProblem
  current: Grid
  shiftAt: Record<string, RShiftMeta>
  absenceAt: Record<string, { label: string; title: string; pending: boolean }>
  wishNote: Record<string, string>
  openByDay: Record<string, Record<string, number>>
  period: 'draft' | 'released'
  proposal: RProposalView | null
  ai: { available: boolean; reason: string | null; model: string }
  keyQual: string | null
  quals: string[]
  rules: RRules
  canPlan: boolean
}
