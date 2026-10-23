import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { addDays, dateKey, fmtDate, parseDateKey } from '@/lib/time'
import { isoWeek, weekStart } from './lib'
import { MineView, MonthView } from './_views/Mine'
import { OpenView } from './_views/Open'
import { AbsencesView } from './_views/Absences'
import { SwapsView } from './_views/Swaps'
import { PlanView, CoverageView } from './_views/Plan'
import { RosterView } from './_views/Roster'
import { PeriodPicker } from './_ui/PeriodPicker'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.schedule') }
}

const VIEWS = ['week', 'month', 'open', 'absences', 'swaps', 'roster', 'team', 'coverage'] as const
type View = (typeof VIEWS)[number]

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; w?: string; m?: string }> }) {
  const ctx = await getCtx()
  const { t, unit, locale } = ctx
  if (!ctx.can('schedule.read')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const canManage = !!unit && ctx.canHere('schedule.manage')
  let view = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'week'
  if ((view === 'team' || view === 'coverage' || view === 'roster') && !canManage) view = 'week'

  const now = new Date()
  const wParsed = sp.w && /^\d{4}-\d{2}-\d{2}$/.test(sp.w) ? parseDateKey(sp.w) : now
  const week = weekStart(Number.isNaN(wParsed.getTime()) ? now : wParsed)
  const mParsed = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? parseDateKey(sp.m + '-01') : new Date(now.getFullYear(), now.getMonth(), 1)
  const month = Number.isNaN(mParsed.getTime()) ? new Date(now.getFullYear(), now.getMonth(), 1) : mParsed

  const weekBased = view === 'week' || view === 'team' || view === 'coverage'
  const q = (v: View, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ ...(v !== 'week' ? { view: v } : {}), ...extra })
    const s = p.toString()
    return '/schedule' + (s ? '?' + s : '')
  }
  const wk = (d: Date) => ({ w: dateKey(d) })
  const mk = (d: Date) => ({ m: dateKey(d).slice(0, 7) })
  const prevMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1)
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1)

  const tabs: { v: View; label: string }[] = [
    { v: 'week', label: t('schedule.tabs.mine') },
    { v: 'open', label: t('schedule.tabs.open') },
    { v: 'absences', label: t('schedule.tabs.absences') },
    { v: 'swaps', label: t('schedule.tabs.swaps') },
    ...(canManage ? [{ v: 'roster' as View, label: t('roster.tab') }, { v: 'team' as View, label: t('schedule.tabs.team') }, { v: 'coverage' as View, label: t('schedule.tabs.coverage') }] : []),
  ]
  const monthBased = view === 'month' || view === 'roster'
  const period = monthBased
    ? fmtDate(month, locale, { month: 'long', year: 'numeric' })
    : `${t('schedule.kw', { n: isoWeek(week) })} · ${fmtDate(week, locale, { day: '2-digit', month: '2-digit' })}–${fmtDate(addDays(week, 6), locale)}`

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{unit ? `${unit.location.name} · ${unit.name}` : t('schedule.title')}</span>
          <h1>{t('schedule.title')}</h1>
          {(weekBased || monthBased) && <p className="sub">{period}</p>}
        </div>
        {(weekBased || monthBased) && (
          <div className="row">
            {(view === 'week' || view === 'month') && (
              <div className="seg" role="group" aria-label={t('schedule.range')}>
                <Link href={q('week', wk(week))} aria-current={view === 'week' ? 'page' : undefined}>{t('schedule.week')}</Link>
                <Link href={q('month', mk(view === 'month' ? month : week))} aria-current={view === 'month' ? 'page' : undefined}>{t('schedule.month')}</Link>
              </div>
            )}
            <div className="seg" role="group" aria-label={t('schedule.nav')}>
              <Link href={monthBased ? q(view, mk(prevMonth)) : q(view, wk(addDays(week, -7)))} aria-label={t('schedule.prev')}>←</Link>
              <PeriodPicker view={view} month={dateKey(monthBased ? month : week).slice(0, 7)} weekBased={!monthBased} />
              <Link href={monthBased ? q(view, mk(nextMonth)) : q(view, wk(addDays(week, 7)))} aria-label={t('schedule.next')}>→</Link>
            </div>
            <Link className="btn ghost" href={q(view)}>{t('schedule.today')}</Link>
          </div>
        )}
      </div>
      <nav className="tabs" aria-label={t('schedule.title')}>
        {tabs.map((x) => {
          const cur = x.v === view || (x.v === 'week' && view === 'month')
          const extra = weekBased && (x.v === 'week' || x.v === 'team' || x.v === 'coverage') && sp.w ? wk(week) : {}
          return <Link key={x.v} href={q(x.v, extra)} aria-current={cur ? 'page' : undefined}>{x.label}</Link>
        })}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {view === 'week' && <MineView ctx={ctx} week={week} now={now} />}
          {view === 'month' && <MonthView ctx={ctx} month={month} now={now} />}
          {view === 'open' && <OpenView ctx={ctx} now={now} canManage={canManage} />}
          {view === 'absences' && <AbsencesView ctx={ctx} now={now} canManage={canManage} />}
          {view === 'swaps' && <SwapsView ctx={ctx} now={now} canManage={canManage} />}
          {view === 'roster' && <RosterView ctx={ctx} month={dateKey(month).slice(0, 7)} />}
          {view === 'team' && <PlanView ctx={ctx} week={week} now={now} />}
          {view === 'coverage' && <CoverageView ctx={ctx} week={week} now={now} />}
        </div>
      </div>
    </main>
  )
}
