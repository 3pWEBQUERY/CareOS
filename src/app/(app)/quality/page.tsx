import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { aiConfigured } from '@/lib/env'
import { INTL_LOCALE } from '@/i18n/core'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { IconWarn } from '@/components/icons'
import { addDays, fmtDate, fmtNum, hm } from '@/lib/time'
import { AutoFilter, PatternAssistant } from './client'
import { median, patternHints, qualityUnits, STAGES } from './_lib'

export const metadata = { title: 'Quality' }

type SP = Promise<Record<string, string | string[] | undefined>>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const PERIODS = ['30', '90', '365', 'all'] as const

export default async function QualityPage({ searchParams }: { searchParams: SP }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const units = qualityUnits(ctx)
  if (!units.length) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const f = {
    type: one(sp.type),
    stage: one(sp.stage),
    unit: units.some((u) => u.id === one(sp.unit)) ? one(sp.unit) : '',
    period: (PERIODS as readonly string[]).includes(one(sp.period)) ? one(sp.period) : '90',
    resident: one(sp.resident),
    near: one(sp.near) === '1',
  }
  const now = new Date()
  const unitIds = f.unit ? [f.unit] : units.map((u) => u.id)
  const readable = new Set(units.filter((u) => ctx.can('resident.read', { unitId: u.id, locationId: u.locationId })).map((u) => u.id))
  const from = f.period === 'all' ? null : addDays(now, -Number(f.period))

  const where: Prisma.IncidentWhereInput = {
    orgId: ctx.org.id,
    unitId: { in: unitIds },
    ...(from ? { occurredAt: { gte: from } } : {}),
    ...(f.type ? { typeId: f.type } : {}),
    ...(f.stage === 'open' ? { stage: { not: 'closed' } } : f.stage && (STAGES as string[]).includes(f.stage) ? { stage: f.stage as never } : {}),
    ...(f.resident ? { residentId: f.resident } : {}),
    ...(f.near ? { nearMiss: true } : {}),
  }
  const scopeAll: Prisma.IncidentWhereInput = { orgId: ctx.org.id, unitId: { in: unitIds } }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [types, incidents, openCount, monthCount, falls30, closedRows, hintRows, residents] = await Promise.all([
    db.incidentType.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } }),
    db.incident.findMany({
      where,
      include: { type: true, unit: true, resident: { select: { id: true, firstName: true, lastName: true, room: { select: { number: true } } } }, actions: { select: { doneAt: true, taskId: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    }),
    db.incident.count({ where: { ...scopeAll, stage: { not: 'closed' } } }),
    db.incident.count({ where: { ...scopeAll, occurredAt: { gte: monthStart } } }),
    db.incident.count({ where: { ...scopeAll, occurredAt: { gte: addDays(now, -30) }, type: { key: 'fall' } } }),
    db.incident.findMany({ where: { ...scopeAll, stage: 'closed', closedAt: { gte: addDays(now, -365) } }, select: { occurredAt: true, closedAt: true } }),
    db.incident.findMany({
      where: { ...scopeAll, occurredAt: { gte: addDays(now, -90) } },
      select: { occurredAt: true, place: true, severity: true, nearMiss: true, residentId: true, unitId: true, type: { select: { key: true, name: true } }, resident: { select: { id: true, firstName: true, lastName: true } } },
    }),
    db.resident.findMany({
      where: { orgId: ctx.org.id, unitId: { in: unitIds.filter((id) => readable.has(id)) }, incidents: { some: {} } },
      select: { id: true, firstName: true, lastName: true, room: { select: { number: true } } },
      orderBy: { lastName: 'asc' },
    }),
  ])

  // Erledigt-Status der Massnahmen aus den verknüpften Aufgaben
  const taskIds = incidents.flatMap((i) => i.actions.map((a) => a.taskId).filter((x): x is string => !!x))
  const tasks = taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true } }) : []
  const taskDone = new Map(tasks.map((k) => [k.id, k.status === 'done' || k.status === 'partial']))
  const actionDone = (a: { doneAt: Date | null; taskId: string | null }) => (a.taskId && taskDone.has(a.taskId) ? taskDone.get(a.taskId)! : a.doneAt != null)

  const med = median(closedRows.filter((r) => r.closedAt).map((r) => (r.closedAt!.getTime() - r.occurredAt.getTime()) / 86_400_000))
  const residentReadable = (rid: string) => {
    const r = hintRows.find((h) => h.residentId === rid)
    return !!r && readable.has(r.unitId)
  }
  const hints = patternHints(t, hintRows, now, residentReadable, INTL_LOCALE[locale])
  const canReport = units.some((u) => ctx.can('quality.report', { unitId: u.id, locationId: u.locationId }))
  const sevTone = (s: string) => (s === 'severe' ? 'crit' : s === 'moderate' ? 'warn' : '')

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">CareOS Quality</span>
          <h1>{t('quality.title')}</h1>
          <p className="sub">{t('quality.subtitle')}</p>
        </div>
        {canReport && <Link className="btn primary" href="/quality/new">{t('quality.report.cta')}</Link>}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics q-metrics" aria-label={t('quality.metrics.label')}>
            <Link className="metric" href="/quality?stage=open&period=all"><span className="lbl">{t('quality.metrics.open')}</span><span className={'val' + (openCount ? ' warn' : '')}>{openCount}</span></Link>
            <div className="metric"><span className="lbl">{t('quality.metrics.month')}</span><span className="val">{monthCount}</span></div>
            <Link className="metric" href={`/quality?type=${types.find((x) => x.key === 'fall')?.id ?? ''}&period=30`}><span className="lbl">{t('quality.metrics.falls30')}</span><span className="val">{falls30}</span></Link>
            <div className="metric"><span className="lbl">{t('quality.metrics.median')}</span><span className="val">{med == null ? '–' : fmtNum(med, 1, locale)} <small>{t('quality.metrics.days')}</small></span></div>
          </div>

          <section className="stack-sm" aria-labelledby="q-hints">
            <div className="sec-head">
              <h2 className="sec" id="q-hints">{t('quality.hints.title')}</h2>
              <span className="small muted">{t('quality.hints.window')}</span>
            </div>
            {hints.length ? (
              <div className="stack-sm">
                {hints.map((h, i) => (
                  <div key={i} className={'alert ' + h.tone}>
                    {h.tone === 'warn' && <IconWarn size={16} />}
                    <span className="grow fg">{h.text}</span>
                    {h.href && <Link className="linkbtn small" href={h.href}>{t('quality.hints.open')}</Link>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>{t('quality.hints.none')}</p>
            )}
            {aiConfigured() && ctx.can('ai.use') && <PatternAssistant filter={{ type: f.type || undefined, unit: f.unit || undefined, period: f.period === 'all' ? '3650' : f.period, nearMiss: f.near }} />}
          </section>

          <section className="stack-sm" aria-labelledby="q-list">
            <div className="sec-head">
              <h2 className="sec" id="q-list">{t('quality.list.title')}</h2>
              <span className="small muted">{t('quality.list.count', { n: incidents.length })}</span>
            </div>
            <AutoFilter className="form-grid q-filters">
              <label className="fld"><span className="lbl">{t('quality.filters.type')}</span>
                <select className="field" name="type" defaultValue={f.type}>
                  <option value="">{t('common.all')}</option>
                  {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label className="fld"><span className="lbl">{t('quality.filters.stage')}</span>
                <select className="field" name="stage" defaultValue={f.stage}>
                  <option value="">{t('common.all')}</option>
                  <option value="open">{t('quality.filters.openOnly')}</option>
                  {STAGES.map((s) => <option key={s} value={s}>{t('quality.stages.' + s)}</option>)}
                </select>
              </label>
              {units.length > 1 && (
                <label className="fld"><span className="lbl">{t('quality.filters.unit')}</span>
                  <select className="field" name="unit" defaultValue={f.unit}>
                    <option value="">{t('common.all')}</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
              )}
              <label className="fld"><span className="lbl">{t('quality.filters.period')}</span>
                <select className="field" name="period" defaultValue={f.period}>
                  {PERIODS.map((p) => <option key={p} value={p}>{t('quality.periods.' + p)}</option>)}
                </select>
              </label>
              {residents.length > 0 && (
                <label className="fld"><span className="lbl">{t('quality.filters.resident')}</span>
                  <select className="field" name="resident" defaultValue={f.resident}>
                    <option value="">{t('common.all')}</option>
                    {residents.map((r) => <option key={r.id} value={r.id}>{r.lastName} {r.firstName}{r.room ? ' · ' + r.room.number : ''}</option>)}
                  </select>
                </label>
              )}
              <label className="check" style={{ alignSelf: 'end', minHeight: 34 }}>
                <input type="checkbox" name="near" value="1" defaultChecked={f.near} /> {t('quality.filters.nearMiss')}
              </label>
            </AutoFilter>

            {incidents.length ? (
              <>
              <ul className="list q-cards" aria-label={t('quality.list.title')}>
                {incidents.map((i) => {
                  const done = i.actions.filter(actionDone).length
                  const showName = i.resident && readable.has(i.unitId)
                  return (
                    <li key={i.id}>
                      <Link className="li" href={`/quality/${i.id}`}>
                        <div className="grow">
                          <div className="row-between" style={{ gap: 6 }}>
                            <strong style={{ fontWeight: 500 }}>{i.type.name}</strong>
                            <span className="mono small muted nowrap">{fmtDate(i.occurredAt, locale)} {hm(i.occurredAt)}</span>
                          </div>
                          <div className="small">{showName ? <>{i.resident!.lastName} {i.resident!.firstName}{i.resident!.room && <span className="muted mono"> · {i.resident!.room.number}</span>}</> : i.resident ? <span className="muted">{t('quality.list.residentHidden')}</span> : <span className="muted">{i.unit.name}</span>}</div>
                          <div className="small muted ellipsis">{i.description}</div>
                          <div className="row" style={{ gap: 6, marginTop: 4 }}>
                            <span className={'tag ' + sevTone(i.severity)}>{t('quality.severity.' + i.severity)}</span>
                            <span className={'tag ' + (i.stage === 'closed' ? 'ok' : i.stage === 'reported' ? 'warn' : 'accent')}>{t('quality.stages.' + i.stage)}</span>
                            {i.nearMiss && <span className="tag outline">{t('quality.nearMiss')}</span>}
                            {i.actions.length > 0 && <span className="small muted mono">{t('quality.list.actions')} {done}/{i.actions.length}</span>}
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <div className="tablewrap q-table">
                <table className="stable">
                  <thead>
                    <tr>
                      <th>{t('quality.list.when')}</th>
                      <th>{t('quality.list.type')}</th>
                      <th>{t('quality.list.who')}</th>
                      <th>{t('quality.list.severity')}</th>
                      <th>{t('quality.list.stage')}</th>
                      <th className="right">{t('quality.list.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((i) => {
                      const done = i.actions.filter(actionDone).length
                      const showName = i.resident && readable.has(i.unitId)
                      return (
                        <tr key={i.id} className="clickable">
                          <td className="nowrap"><Link href={`/quality/${i.id}`} className="mono" style={{ color: 'inherit', textDecoration: 'none' }}>{fmtDate(i.occurredAt, locale)} {hm(i.occurredAt)}</Link></td>
                          <td>
                            <Link href={`/quality/${i.id}`} style={{ color: 'inherit', fontWeight: 500, textDecoration: 'none' }}>{i.type.name}</Link>
                            {i.nearMiss && <span className="tag outline" style={{ marginLeft: 6 }}>{t('quality.nearMiss')}</span>}
                            <div className="small muted ellipsis" style={{ maxWidth: '44ch' }}>{i.description}</div>
                          </td>
                          <td>
                            {showName ? <>{i.resident!.lastName} {i.resident!.firstName}{i.resident!.room && <span className="muted mono small"> · {i.resident!.room.number}</span>}</> : i.resident ? <span className="muted">{t('quality.list.residentHidden')}</span> : <span className="muted">–</span>}
                            {units.length > 1 && <div className="small muted">{i.unit.name}</div>}
                          </td>
                          <td><span className={'tag ' + sevTone(i.severity)}>{t('quality.severity.' + i.severity)}</span></td>
                          <td><span className={'tag ' + (i.stage === 'closed' ? 'ok' : i.stage === 'reported' ? 'warn' : 'accent')}>{t('quality.stages.' + i.stage)}</span></td>
                          <td className="right mono nowrap">{i.actions.length ? `${done}/${i.actions.length}` : '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <Empty title={t('quality.list.empty')}>{t('quality.list.emptyHint')}</Empty>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
