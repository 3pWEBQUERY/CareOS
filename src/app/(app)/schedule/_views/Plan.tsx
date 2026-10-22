import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dbDate, fmtDayMonth, sameDay, shiftBounds, weekdayShort, fromDbDate } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { PlanGrid, type GridCov, type GridDay, type GridRow } from '../_ui/PlanGrid'
import { saveTargetsAction } from '../actions'
import { planWeek } from '../lib'

type Plan = Awaited<ReturnType<typeof planWeek>>

function warnings(ctx: Ctx, p: Plan) {
  const { t, locale } = ctx
  const out: { key: string; tone: 'crit' | 'warn'; text: string }[] = []
  const names = new Map(p.staff.map((s) => [s.id, s.short]))
  for (const d of p.coverage) {
    const date = `${weekdayShort(d.day, locale)} ${fmtDayMonth(d.day)}`
    for (const c of d.types) {
      if (c.n < c.target) out.push({ key: `u${d.key}${c.code}`, tone: c.n === 0 || c.target - c.n >= 2 ? 'crit' : 'warn', text: t('schedule.coverage.underLine', { date, shift: c.name, n: c.n, target: c.target }) + (c.open ? ' · ' + t('schedule.coverage.openLine', { n: c.open }) : '') })
      if (p.key && c.target > 0 && !c.hf) out.push({ key: `q${d.key}${c.code}`, tone: 'crit', text: t('schedule.coverage.qualLine', { date, shift: c.name, qual: p.key.name }) })
      for (const x of c.conflicts) out.push({ key: `a${x.shiftId}`, tone: 'warn', text: t('schedule.coverage.absLine', { date, shift: c.name, name: names.get(x.userId) ?? '–' }) })
    }
  }
  return out
}

function Warnings({ ctx, list, limit = 6 }: { ctx: Ctx; list: ReturnType<typeof warnings>; limit?: number }) {
  const { t } = ctx
  if (!list.length) return <div className="alert ok"><span className="grow">✓ {t('schedule.coverage.warningsNone')}</span></div>
  const crit = list.some((w) => w.tone === 'crit')
  return (
    <div className={'alert ' + (crit ? 'crit' : 'warn')} role="status">
      <span className="grow">
        <strong>{t('schedule.coverage.warnings', { n: list.length })}</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }} className="fg">
          {list.slice(0, limit).map((w) => <li key={w.key}>{w.tone === 'crit' ? '▲ ' : ''}{w.text}</li>)}
          {list.length > limit && <li className="muted">{t('common.notifications.more', { n: list.length - limit })}</li>}
        </ul>
      </span>
    </div>
  )
}

/** Teamplanung (Leitung): Wochenraster mit Besetzung und Qualifikationsabdeckung. */
export async function PlanView({ ctx, week, now }: { ctx: Ctx; week: Date; now: Date }) {
  const { t, unit, locale } = ctx
  if (!unit) return <Empty title={t('schedule.noUnit')} />
  const p = await planWeek(ctx.org.id, ctx.org.settings, unit.id, week, 7)
  const quals = await db.qualification.findMany({ where: { orgId: ctx.org.id }, orderBy: { level: 'desc' } })
  const days: GridDay[] = p.coverage.map((d) => ({ key: d.key, label: `${weekdayShort(d.day, locale)} ${fmtDayMonth(d.day)}`, today: sameDay(d.day, now) }))
  const typeById = new Map(p.types.map((x) => [x.id, x]))
  const rows: GridRow[] = p.staff.map((s) => ({
    id: s.id, name: s.name, qual: s.qual, job: s.job,
    hours: Math.round(p.plan.filter((x) => x.userId === s.id).reduce((sum, x) => {
      const ty = typeById.get(x.typeId)!
      const b = shiftBounds(ty, fromDbDate(new Date(x.dateKey + 'T00:00:00Z')))
      return sum + (b.end.getTime() - b.start.getTime()) / 3600000
    }, 0) * 10) / 10,
  }))
  const absences: Record<string, { label: string; title: string; pending: boolean }> = {}
  for (const a of p.absences)
    for (const d of p.coverage)
      if (a.from <= dbDate(d.day) && a.to >= dbDate(d.day))
        absences[`${a.userId}|${d.key}`] = { label: t('schedule.absence.short.' + a.kind), title: `${t('schedule.absence.kinds.' + a.kind)} · ${t('schedule.approval.' + a.status)}`, pending: a.status === 'requested' }
  const coverage: Record<string, GridCov[]> = Object.fromEntries(p.coverage.map((d) => [d.key, d.types.map((c) => ({ code: c.code, n: c.n, target: c.target, hf: c.hf, open: c.open }))]))

  return (
    <>
      <Warnings ctx={ctx} list={warnings(ctx, p)} limit={4} />
      <PlanGrid
        days={days}
        rows={rows}
        shifts={p.plan}
        absences={absences}
        coverage={coverage}
        types={p.types.map((x) => ({ id: x.id, code: x.code, name: x.name, start: x.start, end: x.end }))}
        staff={p.staff.map((s) => ({ id: s.id, name: s.name, qual: s.qual }))}
        quals={quals.map((q) => q.name)}
        unitId={unit.id}
        keyQual={p.key?.name ?? null}
        canManage
      />
      <p className="small muted" style={{ margin: 0 }}>{t('schedule.plan.hint')}</p>
    </>
  )
}

/** Besetzungsübersicht: Ist/Soll je Tag und Dienst, Qualifikation, Unterbesetzung, Soll-Werte. */
export async function CoverageView({ ctx, week, now }: { ctx: Ctx; week: Date; now: Date }) {
  const { t, unit, locale } = ctx
  if (!unit) return <Empty title={t('schedule.noUnit')} />
  const p = await planWeek(ctx.org.id, ctx.org.settings, unit.id, week, 7)
  const list = warnings(ctx, p)
  const slots = p.coverage.flatMap((d) => d.types)
  const under = slots.filter((c) => c.n < c.target).length
  const noQual = slots.filter((c) => c.target > 0 && !c.hf).length
  const [openCount, pendingAbs, pendingSwaps] = await Promise.all([
    db.shift.count({ where: { unitId: unit.id, status: 'open', userId: null, date: { gte: dbDate(week), lte: dbDate(addDays(week, 6)) } } }),
    db.absence.count({ where: { status: 'requested', userId: { in: p.staff.map((s) => s.id) } } }),
    db.swapRequest.count({ where: { status: 'requested', acceptedAt: { not: null }, shift: { unitId: unit.id } } }),
  ])
  const pct = slots.length ? Math.round((slots.filter((c) => c.n >= c.target).length / slots.length) * 100) : 100

  return (
    <>
      <div className="metrics metrics-sm2">
        <div className="metric"><span className="lbl">{t('schedule.coverage.metricsRate')}</span><span className={'val' + (pct < 100 ? ' warn' : ' ok')}>{pct} <small>%</small></span><div className="bar"><i className={pct < 100 ? 'warn' : 'ok'} style={{ width: pct + '%' }} /></div></div>
        <div className="metric"><span className="lbl">{t('schedule.coverage.metricsUnder')}</span><span className={'val' + (under ? ' crit' : '')}>{under} <small>/ {slots.length}</small></span></div>
        {p.key && <div className="metric"><span className="lbl">{t('schedule.coverage.metricsQual', { qual: p.key.name })}</span><span className={'val' + (noQual ? ' crit' : '')}>{noQual}</span></div>}
        <Link className="metric" href="/schedule?view=open"><span className="lbl">{t('schedule.tabs.open')}</span><span className={'val' + (openCount ? ' warn' : '')}>{openCount}</span></Link>
        <Link className="metric" href="/schedule?view=absences"><span className="lbl">{t('schedule.coverage.metricsPending')}</span><span className={'val' + (pendingAbs + pendingSwaps ? ' warn' : '')}>{pendingAbs + pendingSwaps}</span></Link>
      </div>

      <Warnings ctx={ctx} list={list} limit={12} />

      <div className="tablewrap">
        <table className="stable">
          <thead>
            <tr>
              <th>{t('schedule.cols.date')}</th>
              {p.types.map((x) => <th key={x.id}><span className={'sh ' + x.code}>{x.code}</span> {x.name} <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{t('schedule.coverage.target')} {p.targets[x.code]}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {p.coverage.map((d) => (
              <tr key={d.key}>
                <th scope="row" className="nowrap mono" style={sameDay(d.day, now) ? { color: 'var(--accent)' } : undefined}>{weekdayShort(d.day, locale)} {fmtDayMonth(d.day)}</th>
                {d.types.map((c) => {
                  const short = c.n < c.target
                  return (
                    <td key={c.code}>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <span className={'mono ' + (short ? (c.n === 0 || c.target - c.n >= 2 ? 'crit-text' : 'warn-text') : 'ok-text')} style={{ minWidth: 54 }}>{c.n} / {c.target}{short ? ' ▼' : ' ✓'}</span>
                        <div className="bar" style={{ flex: 1, minWidth: 40 }}><i className={short ? 'warn' : 'ok'} style={{ width: `${c.target ? Math.min(100, (c.n / c.target) * 100) : 100}%` }} /></div>
                      </div>
                      <div className="small" style={{ marginTop: 3 }}>
                        {p.key && c.target > 0 && (c.hf ? <span className="ok-text">✓ {p.key.name}</span> : <span className="crit-text">✕ {t('schedule.coverage.missingQual', { qual: p.key.name })}</span>)}
                        {c.open > 0 && <span className="tag warn" style={{ marginLeft: 6 }}>{t('schedule.coverage.openLine', { n: c.open })}</span>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="tg">
          <div className="card-head"><h2 id="tg">{t('schedule.coverage.targets')}</h2></div>
          <div className="card-body">
            <ActionForm action={saveTargetsAction} success="schedule.coverage.targetsSaved" reset={false}>
              <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                {p.types.map((x) => (
                  <label key={x.id} className="fld">
                    <span className="lbl">{x.code} · {x.name}</span>
                    <input type="number" name={'target_' + x.code} className="field mono" min={0} max={50} step={1} defaultValue={p.targets[x.code]} inputMode="numeric" />
                  </label>
                ))}
              </div>
              <p className="small muted" style={{ margin: 0 }}>{t('schedule.coverage.targetsHint')}</p>
              <div className="form-actions"><Submit>{t('schedule.coverage.saveTargets')}</Submit></div>
            </ActionForm>
          </div>
        </section>
        <section className="card" aria-labelledby="int">
          <div className="card-head"><h2 id="int">{t('schedule.integration.title')}</h2><span className="tag outline">{t('schedule.integration.tag')}</span></div>
          <div className="card-body stack-sm">
            <p className="small fg2" style={{ margin: 0 }}>{t('schedule.integration.body')}</p>
            {ctx.can('admin.integrations') ? <Link className="linkbtn small" href="/admin/integrations">{t('schedule.integration.link')} →</Link> : <span className="small muted">{t('schedule.integration.ask')}</span>}
          </div>
        </section>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('schedule.coverage.hint')}</p>
    </>
  )
}

