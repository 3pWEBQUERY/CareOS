import Link from 'next/link'
import { getCtx, type Ctx } from '@/lib/context'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ChartCard, Columns, DataTable, MeterList, StatusBar } from '@/components/insights/charts'
import { fmtDate, fmtDayMonth, fmtNum, weekdayShort } from '@/lib/time'
import { careData, managementData, workforceData } from './_data'
import { Filter } from './Filter'
import { shiftName } from '@/lib/shift-name'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('insights.title') }
}

const TABS = ['care', 'management', 'workforce'] as const
type Tab = (typeof TABS)[number]
const PERIODS = ['7', '14', '30', '90'] as const

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const units = ctx.units.filter((u) => ctx.can('insights.view', { unitId: u.id, locationId: u.locationId }))
  if (!units.length) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const tab: Tab = (TABS as readonly string[]).includes(str('tab')) ? (str('tab') as Tab) : 'care'
  const unit = units.find((u) => u.id === str('unit'))?.id ?? ''
  const period = (PERIODS as readonly string[]).includes(str('period')) ? str('period') : '14'
  const unitIds = unit ? [unit] : units.map((u) => u.id)
  const scope = { orgId: ctx.org.id, unitIds, days: Number(period), now: new Date() }
  const q = (over: Record<string, string>) => '?' + new URLSearchParams({ tab, ...(unit ? { unit } : {}), period, ...over }).toString()
  const scopeName = unit ? units.find((u) => u.id === unit)!.name : units.length === ctx.units.length && units.length > 1 ? t('insights.allUnits') : units.map((u) => u.shortName ?? u.name).join(', ')

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">CareOS Insights</span>
          <h1>{t('insights.title')}</h1>
          <p className="sub">{scopeName}</p>
        </div>
        <nav className="seg" aria-label={t('insights.dashboards')}>
          {TABS.map((x) => <Link key={x} href={q({ tab: x })} aria-current={tab === x ? 'page' : undefined} style={{ minHeight: 34, display: 'inline-flex', alignItems: 'center' }}>{t('insights.tabs.' + x)}</Link>)}
        </nav>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="alert info" role="note">
            <span className="grow"><strong>{t('insights.notice.title')}</strong><span className="fg">{t('insights.notice.text')}</span></span>
          </div>
          <Filter keep={{ tab }}>
            {units.length > 1 && (
              <label className="fld" style={{ minWidth: 200 }}><span className="lbl">{t('insights.filters.unit')}</span>
                <select className="field" name="unit" defaultValue={unit}>
                  <option value="">{t('insights.allUnits')}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.location.name} · {u.name}</option>)}
                </select>
              </label>
            )}
            {tab !== 'workforce' && (
              <label className="fld" style={{ minWidth: 160 }}><span className="lbl">{t('insights.filters.period')}</span>
                <select className="field" name="period" defaultValue={period}>
                  {PERIODS.map((p) => <option key={p} value={p}>{t('insights.periods.p' + p)}</option>)}
                </select>
              </label>
            )}
            {tab === 'workforce' && <span className="small muted" style={{ paddingBottom: 8 }}>{t('insights.workforce.window')}</span>}
          </Filter>
          {tab === 'care' && <Care ctx={ctx} scope={scope} />}
          {tab === 'management' && <Management ctx={ctx} scope={scope} />}
          {tab === 'workforce' && <Workforce ctx={ctx} scope={scope} />}
        </div>
      </div>
    </main>
  )
}

type Scope = { orgId: string; unitIds: string[]; days: number; now: Date }
const pct = (v: number | null, locale: Ctx['locale']) => (v == null ? '–' : fmtNum(v, 0, locale) + ' %')
const labels = (ctx: Ctx) => ({ table: ctx.t('insights.showTable'), csv: ctx.t('insights.csv') })
const csvName = (ctx: Ctx, key: string) => `careos-${key}-${new Date().toISOString().slice(0, 10)}`

// ───────── Pflege ─────────

async function Care({ ctx, scope }: { ctx: Ctx; scope: Scope }) {
  const { t, locale } = ctx
  const d = await careData(scope)
  const L = labels(ctx)
  const readable = (unitId: string) => ctx.can('resident.read', { unitId, locationId: ctx.units.find((u) => u.id === unitId)?.locationId })
  const fluidsBelow = d.fluids.filter((f) => f.below)
  const name = (r: { id: string; firstName: string; lastName: string; room: { number: string } | null; unitId: string }) =>
    readable(r.unitId) ? <Link className="linkbtn" href={`/residents/${r.id}`}>{r.lastName} {r.firstName}</Link> : <span className="muted">{t('insights.care.hidden')}</span>
  return (
    <>
      <div className="metrics" aria-label={t('insights.tabs.care')}>
        <Link className="metric" href="/tasks"><span className="lbl">{t('insights.care.openToday')}</span><span className="val">{d.openToday}</span></Link>
        <div className="metric"><span className="lbl">{t('insights.care.overdue', { days: scope.days })}</span><span className={'val' + (d.overdueTotal ? ' crit' : '')}>{d.overdueTotal}</span></div>
        <div className="metric"><span className="lbl">{t('insights.care.falls30')}</span><span className="val">{d.falls30}</span></div>
        <div className="metric"><span className="lbl">{t('insights.care.wounds')}</span><span className="val">{d.wounds.total}</span></div>
        <div className="metric"><span className="lbl">{t('insights.care.weightLoss')}</span><span className={'val' + (d.weightLoss.length ? ' warn' : '')}>{d.weightLoss.length} <small>/ {d.weighed}</small></span></div>
        <div className="metric"><span className="lbl">{t('insights.care.fluidBelow')}</span><span className={'val' + (fluidsBelow.length ? ' warn' : '')}>{fluidsBelow.length} <small>/ {d.fluids.length}</small></span></div>
      </div>

      <div className="grid-3" style={{ alignItems: 'stretch' }}>
        <ChartCard
          title={t('insights.care.fallsTrend')}
          sub={t('insights.care.fallsTrendSub')}
          current={d.fallWeeks.reduce((s, w) => s + w.n, 0)}
          table={{ head: [t('insights.week'), t('insights.from'), t('insights.care.falls')], rows: d.fallWeeks.map((w) => [`${t('insights.ux.wk')} ${w.kw}`, fmtDate(w.start, locale), w.n]) }}
          csvName={csvName(ctx, 'stuerze')}
          labels={L}
        >
          <Columns
            tones={['accent']}
            ariaLabel={t('insights.care.fallsAria', { n: d.fallWeeks.reduce((s, w) => s + w.n, 0) })}
            data={d.fallWeeks.map((w) => ({ label: String(w.kw), title: `${t('insights.ux.wk')} ${w.kw} (${fmtDayMonth(w.start)}): ${w.n}`, values: [w.n] }))}
            integer fmt={(v) => String(Math.round(v))} yUnit={t('insights.ux.count')} xPrefix={t('insights.ux.wk') + '\u2009'}
          />
        </ChartCard>

        <ChartCard
          title={t('insights.care.overdueByCat')}
          sub={t('insights.care.overdueByCatSub', { days: scope.days })}
          current={d.overdueTotal}
          table={{ head: [t('insights.category'), t('insights.count')], rows: d.overdueRows.map((r) => [r.category, r.n]) }}
          csvName={csvName(ctx, 'ueberfaellig')}
          labels={L}
        >
          {d.overdueRows.length ? (
            <MeterList ariaLabel={t('insights.care.overdueByCat')} rows={d.overdueRows.slice(0, 8).map((r) => ({ label: r.category, value: r.n, text: String(r.n), tone: 'crit' }))} />
          ) : <p className="small muted" style={{ margin: '8px 0' }}>{t('insights.care.noOverdue')}</p>}
        </ChartCard>

        <ChartCard
          title={t('insights.care.woundsTitle')}
          sub={t('insights.care.woundsSub', { open: d.wounds.open, healing: d.wounds.healing, residents: d.wounds.residents })}
          current={d.wounds.total}
          table={{ head: [t('insights.care.woundKind'), t('insights.count')], rows: [...d.wounds.kinds.map(([k, n]) => [k, n] as (string | number)[]), [t('insights.care.inHouse'), d.wounds.inHouse]] }}
          csvName={csvName(ctx, 'wunden')}
          labels={L}
        >
          {d.wounds.total ? (
            <>
              <MeterList ariaLabel={t('insights.care.woundsTitle')} rows={d.wounds.kinds.map(([k, n]) => ({ label: k, value: n, text: String(n) }))} />
              <p className="small muted" style={{ margin: 0 }}>{t('insights.care.inHouseText', { n: d.wounds.inHouse })}</p>
            </>
          ) : <p className="small muted" style={{ margin: '8px 0' }}>{t('insights.care.noWounds')}</p>}
        </ChartCard>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="wl-h">
          <div className="card-head"><h2 id="wl-h">{t('insights.care.weightTitle')}</h2><span className="small muted">{t('insights.care.weightSub')}</span></div>
          <div className="card-body stack-sm">
            {d.weightLoss.length ? (
              <DataTable
                open
                labels={L}
                csvName={csvName(ctx, 'gewicht')}
                table={{
                  head: [t('insights.care.resident'), t('insights.care.weightFrom'), t('insights.care.weightTo'), t('insights.care.change')],
                  rows: d.weightLoss.map((w) => [readable(w.resident.unitId) ? `${w.resident.lastName} ${w.resident.firstName}` : t('insights.care.hidden'), fmtNum(w.from, 1, locale), fmtNum(w.to, 1, locale), '▼ ' + fmtNum(w.pct, 1, locale) + ' %']),
                }}
              />
            ) : <p className="small muted" style={{ margin: 0 }}>{t('insights.care.noWeightLoss', { n: d.weighed })}</p>}
          </div>
        </section>

        <section className="card" aria-labelledby="fl-h">
          <div className="card-head"><h2 id="fl-h">{t('insights.care.fluidTitle')}</h2><span className="small muted">{t('insights.care.fluidSub', { pct: Math.round(d.fluidShare * 100) })}</span></div>
          {d.fluids.length ? (
            <div className="card-body stack-sm">
              <ul className="ins-meters" aria-label={t('insights.care.fluidTitle')}>
                {d.fluids.map((f) => (
                  <li key={f.resident.id}>
                    <span className="ins-ml ellipsis">{name(f.resident)}{f.resident.room && <span className="muted mono small"> · {f.resident.room.number}</span>}</span>
                    <span className="bar" aria-hidden="true"><i className={f.below ? 'warn' : 'ok'} style={{ width: `${Math.min(100, (f.ml / f.target) * 100)}%` }} /></span>
                    <span className="mono small ins-mv">{f.ml} / {f.target} ml {f.below ? <span className="warn-text">▼</span> : <span className="ok-text">✓</span>}</span>
                  </li>
                ))}
              </ul>
              <p className="small muted" style={{ margin: 0 }}>{t('insights.care.fluidLegend')}</p>
              <DataTable
                labels={L}
                csvName={csvName(ctx, 'trinkmenge')}
                table={{
                  head: [t('insights.care.resident'), t('insights.care.documented'), t('insights.care.expected'), t('insights.care.target'), t('insights.care.status')],
                  rows: d.fluids.map((f) => [readable(f.resident.unitId) ? `${f.resident.lastName} ${f.resident.firstName}` : t('insights.care.hidden'), f.ml, f.expected, f.target, f.below ? t('insights.care.below') : t('insights.care.onTrack')]),
                }}
              />
            </div>
          ) : <div className="card-body small muted">{t('insights.care.noFluidTargets')}</div>}
        </section>
      </div>
    </>
  )
}

// ───────── Management ─────────

async function Management({ ctx, scope }: { ctx: Ctx; scope: Scope }) {
  const { t, locale } = ctx
  const d = await managementData({ ...scope, settings: ctx.org.settings })
  const L = labels(ctx)
  const plannedSum = d.care.reduce((s, c) => s + c.planned, 0)
  const docSum = d.care.reduce((s, c) => s + c.documented, 0)
  const careLabel = (c: (typeof d.care)[number]) => (d.useWeeks ? t('insights.ux.wk') + ('kw' in c ? c.kw : '') : `${c.start.getDate()}.`)
  const careTitle = (c: (typeof d.care)[number]) =>
    `${d.useWeeks ? t('insights.ux.wk') + ' ' + ('kw' in c ? c.kw : '') : weekdayShort(c.start, locale) + ' ' + fmtDayMonth(c.start)}: ${t('insights.management.planned')} ${c.planned} ${t('common.minutes')}, ${t('insights.management.documented')} ${c.documented} ${t('common.minutes')}`
  const careData = d.care.map((c) => ({ label: careLabel(c), title: careTitle(c), values: [c.planned, c.documented] }))
  const trendTypes = d.trend.filter((x) => x.total > 0)
  const notePct = d.completed ? (d.withNote / d.completed) * 100 : null
  const tone = (v: number | null): 'ok' | 'warn' | 'crit' | '' => (v == null ? '' : v >= 90 ? 'ok' : v >= 70 ? 'warn' : 'crit')
  return (
    <>
      <div className="metrics" aria-label={t('insights.tabs.management')}>
        <div className="metric"><span className="lbl">{t('insights.management.careShare')}</span><span className="val">{pct(plannedSum ? (docSum / plannedSum) * 100 : null, locale)}</span><div className="bar"><i style={{ width: `${plannedSum ? Math.min(100, (docSum / plannedSum) * 100) : 0}%` }} /></div></div>
        <div className="metric"><span className="lbl">{t('insights.management.incidents', { n: d.trend[0]?.weeks.length ?? 0 })}</span><span className="val">{d.incidentTotal}</span></div>
        <div className="metric"><span className="lbl">{t('insights.management.notesPerShift')}</span><span className={'val ' + tone(d.notesPerShiftPct)}>{pct(d.notesPerShiftPct, locale)}</span></div>
        <div className="metric"><span className="lbl">{t('insights.management.withNote')}</span><span className="val">{pct(notePct, locale)}</span></div>
        <div className="metric"><span className="lbl">{t('insights.management.coverage')}</span><span className={'val ' + tone(d.coveredPct)}>{d.anyTarget ? pct(d.coveredPct, locale) : '–'}</span></div>
        <div className="metric"><span className="lbl">{t('insights.management.mandatory')}</span><span className={'val ' + tone(d.mandatoryPct)}>{pct(d.mandatoryPct, locale)}</span></div>
      </div>

      <div className="grid-3" style={{ alignItems: 'stretch' }}>
        <ChartCard
          title={t('insights.management.careTitle')}
          sub={t(d.useWeeks ? 'insights.management.careSubWeeks' : 'insights.management.careSubDays', { n: d.care.length })}
          current={<>{fmtNum(docSum / 60, 0, locale)} / {fmtNum(plannedSum / 60, 0, locale)} <span className="small muted">h</span></>}
          legend={[{ label: t('insights.management.planned'), kind: 'bar muted' }, { label: t('insights.management.documented'), kind: 'bar' }]}
          table={{ head: [t(d.useWeeks ? 'insights.week' : 'insights.day'), t('insights.management.plannedMin'), t('insights.management.documentedMin'), t('insights.management.share')], rows: d.care.map((c) => [d.useWeeks ? `${t('insights.ux.wk')} ${'kw' in c ? c.kw : ''}` : fmtDate(c.start, locale), c.planned, c.documented, c.planned ? Math.round((c.documented / c.planned) * 100) + ' %' : '–']) }}
          csvName={csvName(ctx, 'pflegeaufwand')}
          labels={L}
        >
          <Columns tones={['muted', 'accent']} width={400} height={146} ariaLabel={t('insights.management.careAria', { planned: plannedSum, documented: docSum })} data={careData} labelLast={false} yUnit={t('common.minutes')} />
        </ChartCard>
              <section className="card" aria-labelledby="dq-h">
          <div className="card-head"><h2 id="dq-h">{t('insights.management.docTitle')}</h2><span className="small muted">{t('insights.periods.p' + scope.days)}</span></div>
          <div className="card-body stack-sm">
            <span className="lbl">{t('insights.management.notesPerShiftLong', { n: d.residents })}</span>
            <MeterList ariaLabel={t('insights.management.notesPerShift')} max={100} rows={d.perShift.map((p) => ({ label: shiftName(t, p), value: p.pct ?? 0, text: pct(p.pct, locale), tone: tone(p.pct), hint: t('insights.management.shiftsN', { n: p.shifts }) }))} />
            <span className="lbl" style={{ marginTop: 6 }}>{t('insights.management.withNoteLong')}</span>
            <MeterList ariaLabel={t('insights.management.withNote')} max={100} rows={[{ label: t('insights.management.completions', { n: d.completed }), value: notePct ?? 0, text: pct(notePct, locale), hint: `(${d.withNote})` }]} />
            <DataTable labels={L} csvName={csvName(ctx, 'dokumentation')} table={{ head: [t('insights.management.measure'), t('insights.value')], rows: [...d.perShift.map((p) => [`${t('insights.management.notesPerShift')} · ${shiftName(t, p)}`, pct(p.pct, locale)]), [t('insights.management.withNote'), pct(notePct, locale)]] }} />
          </div>
        </section>

        <section className="card" aria-labelledby="tr-h">
          <div className="card-head"><h2 id="tr-h">{t('insights.management.trainingTitle')}</h2><span className="small muted">{t('insights.staffN', { n: d.staff })}</span></div>
          <div className="card-body stack-sm">
            {d.training.length ? (
              <>
                <MeterList ariaLabel={t('insights.management.trainingTitle')} max={100} rows={d.training.map((c) => { const v = c.staff ? (c.valid / c.staff) * 100 : 0; return { label: c.title, value: v, text: pct(v, locale), tone: tone(v), hint: `(${c.valid}/${c.staff})` } })} />
                <DataTable labels={L} csvName={csvName(ctx, 'schulungen')} table={{ head: [t('insights.course'), t('insights.workforce.valid'), t('insights.staff'), t('insights.value')], rows: d.training.map((c) => [c.title, c.valid, c.staff, pct(c.staff ? (c.valid / c.staff) * 100 : null, locale)]) }} />
              </>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('insights.management.noMandatory')}</p>}
          </div>
        </section>
            </div>

      <section className="stack-sm" aria-labelledby="it-h">
        <div className="sec-head"><h2 className="sec" id="it-h">{t('insights.management.trendTitle')}</h2><span className="small muted">{t('insights.management.trendSub', { n: d.trend[0]?.weeks.length ?? 0 })}</span></div>
        {trendTypes.length ? (
          <div className="grid-3">
            {trendTypes.map((x) => (
              <ChartCard
                key={x.type.id}
                title={x.type.name}
                current={x.total}
                table={{ head: [t('insights.week'), t('insights.count')], rows: x.weeks.map((w) => [`${t('insights.ux.wk')} ${w.kw}`, w.n]) }}
                csvName={csvName(ctx, 'ereignisse-' + x.type.key)}
                labels={L}
              >
                <Columns tones={['accent']} height={96} ariaLabel={t('insights.management.trendAria', { type: x.type.name, n: x.total })} data={x.weeks.map((w) => ({ label: String(w.kw), title: `${x.type.name} ${t('insights.ux.wk')} ${w.kw}: ${w.n}`, values: [w.n] }))} integer fmt={(v) => String(Math.round(v))} yUnit={t('insights.ux.count')} xPrefix={t('insights.ux.wk') + '\u2009'} />
              </ChartCard>
            ))}
          </div>
        ) : <Empty title={t('insights.management.noIncidents')} />}
      </section>

      <section className="card" aria-labelledby="cv-h">
        <div className="card-head"><h2 id="cv-h">{t('insights.management.coverageTitle')}</h2><span className="small muted">{t('insights.management.coverageSub')}</span></div>
        <div className="card-body stack-sm">
          {!d.anyTarget && <div className="alert"><span className="grow">{t('insights.management.noTarget')}</span></div>}
          <div style={{ overflowX: 'auto' }} data-scroll>
            <table className="cov" aria-label={t('insights.management.coverageTitle')}>
              <thead>
                <tr><th scope="col"><span className="sr-only">{t('insights.shift')}</span></th>{d.coverage[0]?.days.map((x) => <th key={x.day.toISOString()} scope="col">{weekdayShort(x.day, locale)}<br /><span className="mono">{fmtDayMonth(x.day)}</span></th>)}</tr>
              </thead>
              <tbody>
                {d.coverage.map((c) => (
                  <tr key={c.code}>
                    <th scope="row">{shiftName(t, c)}</th>
                    {c.days.map((x) => {
                      const cls = x.target ? (x.staffed >= x.target ? 'ok' : x.staffed >= x.target - 1 ? 'warn' : 'crit') : ''
                      return (
                        <td key={x.day.toISOString()} className={cls} title={`${shiftName(t, c)} ${fmtDayMonth(x.day)}: ${x.staffed}${x.target ? ' / ' + x.target : ''}${x.open ? ' · ' + t('insights.management.openN', { n: x.open }) : ''}`}>
                          {x.staffed}{x.target ? <span className="muted">/{x.target}</span> : null}{x.open ? <sup>+{x.open}</sup> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t(d.anyTarget ? 'insights.management.coverageLegend' : 'insights.management.coverageLegendNoTarget')}</p>
          <DataTable labels={L} csvName={csvName(ctx, 'abdeckung')} table={{ head: [t('insights.day'), t('insights.shift'), t('insights.management.staffed'), t('insights.management.target'), t('insights.management.open')], rows: d.coverage.flatMap((c) => c.days.map((x) => [fmtDate(x.day, locale), shiftName(t, c), x.staffed, x.target ?? '–', x.open])) }} />
        </div>
      </section>
    </>
  )
}

// ───────── Workforce ─────────

async function Workforce({ ctx, scope }: { ctx: Ctx; scope: Scope }) {
  const { t, locale } = ctx
  const d = await workforceData({ ...scope, canTeam: ctx.can('team.read'), canDocs: ctx.can('docs.read') })
  const L = labels(ctx)
  const absData = d.absDays.map((a) => ({ label: `${a.day.getDate()}.`, title: `${weekdayShort(a.day, locale)} ${fmtDayMonth(a.day)}: ${t('insights.workforce.approved')} ${a.approved}, ${t('insights.workforce.requested')} ${a.requested}`, values: [a.approved, a.requested] }))
  const trainingValid = d.training.reduce((s, c) => s + c.valid, 0)
  const trainingAll = d.training.reduce((s, c) => s + c.staff, 0)
  const ackAvg = d.ackItems.length && d.staff ? (d.ackItems.reduce((s, a) => s + a.n, 0) / (d.ackItems.length * d.staff)) * 100 : null
  const tone = (v: number): 'ok' | 'warn' | 'crit' => (v >= 90 ? 'ok' : v >= 70 ? 'warn' : 'crit')
  return (
    <>
      <div className="metrics" aria-label={t('insights.tabs.workforce')}>
        <div className="metric"><span className="lbl">{t('insights.workforce.staff')}</span><span className="val">{d.staff}</span></div>
        <div className="metric"><span className="lbl">{t('insights.workforce.absentToday')}</span><span className="val">{d.absentToday}</span></div>
        <Link className="metric" href="/schedule?view=open"><span className="lbl">{t('insights.workforce.openShifts')}</span><span className={'val' + (d.openShifts.length ? ' warn' : '')}>{d.openShifts.length}</span></Link>
        <div className="metric"><span className="lbl">{t('insights.workforce.mandatory')}</span><span className="val">{pct(trainingAll ? (trainingValid / trainingAll) * 100 : null, locale)}</span></div>
        <div className="metric"><span className="lbl">{t('insights.workforce.ackRate')}</span><span className="val">{pct(ackAvg, locale)}</span></div>
      </div>

      <div className="grid-3" style={{ alignItems: 'stretch' }}>
        <ChartCard
          title={t('insights.workforce.absTitle')}
          sub={t('insights.workforce.absSub')}
          current={<>{Math.max(0, ...d.absDays.map((a) => a.approved + a.requested))} <span className="small muted">{t('insights.workforce.peak')}</span></>}
          legend={[{ label: t('insights.workforce.approved'), kind: 'bar' }, { label: t('insights.workforce.requested'), kind: 'bar muted' }]}
          table={{ head: [t('insights.day'), t('insights.workforce.approved'), t('insights.workforce.requested')], rows: d.absDays.map((a) => [fmtDate(a.day, locale), a.approved, a.requested]) }}
          csvName={csvName(ctx, 'abwesenheiten')}
          labels={L}
        >
          <Columns tones={['accent', 'muted']} width={400} height={146} integer ariaLabel={t('insights.workforce.absAria')} data={absData} fmt={(v) => String(Math.round(v))} labelLast={false} yUnit={t('insights.ux.people')} />
          {d.absenceKinds.length > 0 && (
            <div className="chips" aria-label={t('insights.workforce.byKind')}>
              {d.absenceKinds.map(([k, v]) => <span key={k} className="chip">{t('insights.absence.' + k)} <span className="mono">{v.approved + v.requested}</span> <span className="muted small">· {t('insights.workforce.personDays', { n: v.days })}</span></span>)}
            </div>
          )}
        </ChartCard>
              <section className="card" aria-labelledby="os-h">
          <div className="card-head"><h2 id="os-h">{t('insights.workforce.openTitle')}</h2><Link className="linkbtn small" href="/schedule?view=open">{t('insights.workforce.toSchedule')}</Link></div>
          {d.openShifts.length ? (
            <ul className="list">
              {d.openShifts.map((s) => (
                <li key={s.id} className="li">
                  <span className={'sh open'}>{s.code}</span>
                  <div className="grow">
                    <div>{weekdayShort(s.date, locale)} {fmtDayMonth(s.date)} · {shiftName(t, s)} <span className="mono small muted">{s.start}–{s.end}</span></div>
                    <div className="small muted">{s.unit}{s.qual ? ' · ' + s.qual : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="card-body small muted">{t('insights.workforce.noOpen')}</div>}
        </section>

        <section className="card" aria-labelledby="mt-h">
          <div className="card-head"><h2 id="mt-h">{t('insights.workforce.trainingTitle')}</h2><span className="small muted">{t('insights.staffN', { n: d.staff })}</span></div>
          <div className="card-body stack">
            {d.training.length ? d.training.map((c) => (
              <div key={c.id} className="stack-sm">
                <div className="row-between"><span style={{ fontWeight: 500 }}>{c.title}</span><span className="mono small">{c.valid}/{c.staff}</span></div>
                <StatusBar ariaLabel={c.title} parts={[
                  { label: t('insights.workforce.valid'), n: c.valid, tone: 'ok' },
                  { label: t('insights.workforce.progress'), n: c.progress, tone: 'accent' },
                  { label: t('insights.workforce.assigned'), n: c.assigned + c.missing, tone: 'none' },
                  { label: t('insights.workforce.overdue'), n: c.overdue + c.expired, tone: 'crit' },
                ]} />
                <div className="legend" style={{ fontSize: '0.75rem' }}>
                  <span><span className="ins-key ok" />{t('insights.workforce.valid')} {c.valid}</span>
                  <span><span className="ins-key accent" />{t('insights.workforce.progress')} {c.progress}</span>
                  <span><span className="ins-key" />{t('insights.workforce.assigned')} {c.assigned + c.missing}</span>
                  <span><span className="ins-key crit" />{t('insights.workforce.overdue')} {c.overdue + c.expired}</span>
                </div>
              </div>
            )) : <p className="small muted" style={{ margin: 0 }}>{t('insights.management.noMandatory')}</p>}
            {d.training.length > 0 && (
              <DataTable labels={L} csvName={csvName(ctx, 'pflichtschulungen')} table={{ head: [t('insights.course'), t('insights.workforce.valid'), t('insights.workforce.progress'), t('insights.workforce.assigned'), t('insights.workforce.overdue')], rows: d.training.map((c) => [c.title, c.valid, c.progress, c.assigned + c.missing, c.overdue + c.expired]) }} />
            )}
          </div>
        </section>
            </div>

      <section className="card" aria-labelledby="ak-h">
        <div className="card-head"><h2 id="ak-h">{t('insights.workforce.ackTitle')}</h2><span className="small muted">{t('insights.workforce.ackSub')}</span></div>
        <div className="card-body stack-sm">
          {d.ackItems.length ? (
            <>
              <MeterList
                ariaLabel={t('insights.workforce.ackTitle')}
                max={100}
                rows={d.ackItems.map((a) => {
                  const v = d.staff ? (a.n / d.staff) * 100 : 0
                  return { label: `${a.kind === 'post' ? t('insights.workforce.post') : t('insights.workforce.document')}: ${a.title}`, value: v, text: pct(v, locale), tone: tone(v), hint: `(${a.n}/${d.staff})` }
                })}
              />
              <DataTable labels={L} csvName={csvName(ctx, 'kenntnisnahmen')} table={{ head: [t('insights.workforce.item'), t('insights.workforce.acked'), t('insights.staff'), t('insights.value')], rows: d.ackItems.map((a) => [a.title, a.n, d.staff, pct(d.staff ? (a.n / d.staff) * 100 : null, locale)]) }} />
            </>
          ) : <p className="small muted" style={{ margin: 0 }}>{t('insights.workforce.noAck')}</p>}
        </div>
      </section>
    </>
  )
}
