import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { aiConfigured, env } from '@/lib/env'
import { dateKey, dbDate, fmtDate, fmtDayMonth, parseDateKey, weekdayShort } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { NumberField } from '@/components/ui/fields'
import { shiftName } from '@/lib/shift-name'
import { DEFAULT_RULES, RULE_LIMITS, isNight, round1, shiftHours, type RRules } from '@/lib/roster/model'
import { loadRoster, monthStart } from '@/lib/roster/server'
import { saveRosterRulesAction } from '../roster-actions'
import { RosterBoard } from '../_roster/RosterBoard'
import type { RProposalView, RosterProps } from '../_roster/types'
import { dbKey } from '../lib'

const STALE_MS = 10 * 60000

/** Monatsplanung (Leitung): Raster, Vorschläge, Regelprüfung und Arbeitszeitregeln. */
export async function RosterView({ ctx, month }: { ctx: Ctx; month: string }) {
  const { t, unit, locale } = ctx
  if (!unit) return <Empty title={t('schedule.noUnit')} />
  const now = new Date()
  const data = await loadRoster(ctx.org.id, ctx.org.settings, unit.id, month, now)
  const [quals, proposalRow] = await Promise.all([
    db.qualification.findMany({ where: { orgId: ctx.org.id }, orderBy: { level: 'desc' } }),
    db.scheduleProposal.findFirst({ where: { unitId: unit.id, month: dbDate(monthStart(month)), status: { in: ['running', 'ready', 'failed'] } }, orderBy: { createdAt: 'desc' } }),
  ])

  const days = data.problem.days.map((k) => {
    const d = parseDateKey(k)
    const wd = weekdayShort(d, locale)
    return { key: k, dom: d.getDate(), wd, label: `${wd} ${fmtDayMonth(d, locale)}`, weekend: d.getDay() === 0 || d.getDay() === 6, past: k < data.today, today: k === data.today }
  })
  const types = data.types.map((x) => ({ id: x.id, code: x.code, name: shiftName(t, x), start: x.start, end: x.end, hours: round1(shiftHours(x)), night: isNight(x) }))
  const absenceAt: RosterProps['absenceAt'] = {}
  for (const [k, a] of Object.entries(data.absenceAt)) absenceAt[k] = { label: t('schedule.absence.short.' + a.kind), title: t('schedule.absence.kinds.' + a.kind), pending: a.status === 'requested' }
  const openByDay: RosterProps['openByDay'] = {}
  for (const s of data.openShifts) {
    const d = dbKey(s.date)
    openByDay[d] = { ...(openByDay[d] ?? {}), [s.shiftType.code]: (openByDay[d]?.[s.shiftType.code] ?? 0) + 1 }
  }

  let proposal: RProposalView | null = null
  if (proposalRow) {
    const stale = proposalRow.status === 'running' && now.getTime() - proposalRow.createdAt.getTime() > STALE_MS
    proposal = {
      id: proposalRow.id,
      status: stale ? 'failed' : (proposalRow.status as RProposalView['status']),
      source: proposalRow.source as RProposalView['source'],
      mode: proposalRow.mode as RProposalView['mode'],
      cells: proposalRow.status === 'ready' ? (proposalRow.cells as RProposalView['cells']) : [],
      summary: proposalRow.status === 'ready' ? (proposalRow.summary as RProposalView['summary']) : null,
      error: stale ? 'error' : proposalRow.error,
      model: proposalRow.model,
    }
  }
  const aiOn = aiConfigured() && ctx.hasModule('ai') && ctx.can('ai.use')
  const canPlan = month >= dateKey(now).slice(0, 7)

  const props: RosterProps = {
    unitId: unit.id,
    month,
    monthLabel: fmtDate(monthStart(month), locale, { month: 'long', year: 'numeric' }),
    days,
    types,
    people: data.people.map((p) => ({ id: p.id, name: p.name, short: p.short, qual: p.qual, job: p.job, pct: p.pct, key: p.key })),
    problem: data.problem,
    current: data.current,
    shiftAt: data.shiftAt,
    absenceAt,
    wishNote: data.wishNote,
    openByDay,
    period: data.period.status,
    proposal,
    ai: { available: aiOn, reason: aiOn ? null : !aiConfigured() ? 'roster.ai.notConfigured' : 'roster.ai.off', model: env.ai.model },
    keyQual: data.key?.name ?? null,
    quals: quals.map((q) => q.name),
    rules: data.problem.rules,
    canPlan,
  }
  return (
    <>
      <RosterBoard {...props} />
      <div className="grid-2 no-print">
        <RulesCard ctx={ctx} rules={data.problem.rules} exportHref={`/schedule/export?unitId=${encodeURIComponent(unit.id)}&m=${month}`} />
        <section className="card" aria-labelledby="rst-cov">
          <div className="card-head"><h2 id="rst-cov">{t('schedule.coverage.targets')}</h2></div>
          <div className="card-body stack-sm">
            <p className="small fg2" style={{ margin: 0 }}>{types.map((x) => `${x.code} ${data.problem.targets[x.code] ?? 0}`).join(' · ')}</p>
            <p className="small muted" style={{ margin: 0 }}>{t('schedule.coverage.targetsHint')}</p>
            <Link className="linkbtn small" href="/schedule?view=coverage">{t('schedule.tabs.coverage')} →</Link>
          </div>
        </section>
      </div>
    </>
  )
}

function RulesCard({ ctx, rules, exportHref }: { ctx: Ctx; rules: RRules; exportHref: string }) {
  const { t } = ctx
  const unit: Partial<Record<keyof RRules, string>> = { weeklyHours: 'h', minRestHours: 'h', maxWeeklyHours: 'h' }
  return (
    <section className="card" aria-labelledby="rst-rules">
      <div className="card-head"><h2 id="rst-rules">{t('roster.rules.title')}</h2><a className="linkbtn small" href={exportHref} download>{t('roster.payroll.link')}</a></div>
      <div className="card-body">
        <ActionForm action={saveRosterRulesAction} success="roster.rules.saved" reset={false}>
          <div className="form-grid">
            {(Object.keys(DEFAULT_RULES) as (keyof RRules)[]).map((k) => (
              <NumberField key={k} label={t('roster.rules.' + k)} name={k} unit={unit[k]} min={RULE_LIMITS[k][0]} max={RULE_LIMITS[k][1]} step={k === 'weeklyHours' || k === 'minRestHours' ? 0.25 : 1} defaultValue={rules[k]} required />
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('roster.rules.hint')}</p>
          <div className="form-actions"><Submit>{t('roster.rules.save')}</Submit></div>
        </ActionForm>
      </div>
    </section>
  )
}
