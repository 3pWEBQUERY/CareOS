import { db } from '@/lib/db'
import { addDays, fmtNum, fmtRel, hm, sameDay, weekdayShort } from '@/lib/time'
import { abnormalKeys, flag, mergeLimits, VITALS, type VitalKey } from '@/lib/vitals'
import { LineChart, type Point } from '@/components/ui/LineChart'
import { pageResident, userNames, residentTitle } from '../../_lib/resident'
import { VitalForm, Thresholds } from './VitalForm'
import { AskQuestion } from '@/components/visit/AskQuestion'
import { vitalRefLabel } from '@/lib/visit-data'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'vitals')
}

export default async function VitalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const now = new Date()
  const [recent, week, limitRows, glucoseCount, asked] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId: r.id }, orderBy: { at: 'desc' }, take: 10 }),
    db.vitalSign.findMany({ where: { residentId: r.id, at: { gte: addDays(now, -7) } }, orderBy: { at: 'asc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
    db.vitalSign.count({ where: { residentId: r.id, glucose: { not: null } } }),
    // Bereits für die Visite vorgemerkte Messungen (offene Fragen mit Bezug auf einen Vitalwert)
    db.visitQuestion.findMany({ where: { orgId: ctx.org.id, residentId: r.id, status: 'open', refType: 'vital' }, select: { refId: true } }),
  ])
  const askedIds = new Set(asked.map((q) => q.refId))
  const limits = mergeLimits(limitRows, r.id)
  const orgLimits = mergeLimits(limitRows)
  const individual = new Set(limitRows.filter((l) => l.residentId === r.id).map((l) => l.key))
  const showGlucose = glucoseCount > 0 || r.risks.some((x) => /diab/i.test(x))
  const names = await userNames(ctx, recent.map((v) => v.recordedById))
  const f = (k: VitalKey, v: number | null | undefined) => fmtNum(v, VITALS[k].dec, locale)
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const todayAbn = recent.filter((v) => sameDay(v.at, now)).reduce((a, v) => a + abnormalKeys(v, limits).length, 0)

  const formKeys: VitalKey[] = ['sys', 'dia', 'pulse', 'temp', 'spo2', ...(showGlucose ? (['glucose'] as VitalKey[]) : []), 'respRate', 'pain', 'weight']
  const cols: { key: VitalKey | 'bp'; label: string }[] = [
    { key: 'bp', label: `${t('chart.vitals.bpShort')} mmHg` },
    { key: 'pulse', label: `${t('common.vitals.pulse')} /min` },
    { key: 'temp', label: `${t('chart.vitals.tempShort')} °C` },
    { key: 'spo2', label: 'SpO₂ %' },
    ...(showGlucose ? [{ key: 'glucose' as const, label: `${t('chart.vitals.bgShort')} mmol/l` }] : []),
    { key: 'respRate', label: `${t('chart.vitals.rrShort')} /min` },
    { key: 'pain', label: `${t('common.vitals.pain')} NRS` },
    { key: 'weight', label: `${t('common.vitals.weight')} kg` },
  ]
  const usedCols = cols.filter((c) => c.key === 'bp' ? recent.some((v) => v.sys != null) : recent.some((v) => v[c.key as VitalKey] != null) || ['pulse', 'temp', 'spo2'].includes(c.key))

  const chartFor = (title: string, key: VitalKey, key2?: VitalKey) => {
    const pts = week.filter((v) => v[key] != null)
    if (!pts.length) return null
    const points: Point[] = pts.map((v, i) => ({
      label: i > 0 && sameDay(pts[i - 1].at, v.at) ? '' : weekdayShort(v.at, locale),
      title: `${weekdayShort(v.at, locale)} ${hm(v.at)}: ${f(key, v[key])}${key2 ? '/' + f(key2, v[key2]) : ''} ${VITALS[key].unit}`,
      v: v[key] as number,
      v2: key2 ? (v[key2] as number | null) : undefined,
    }))
    const last = pts[pts.length - 1]
    const alarm = key !== 'weight' && !!flag(key, last[key], limits) || (key2 ? !!flag(key2, last[key2], limits) : false)
    // Gewicht hat keinen Referenzbereich: Band = Spanne der Woche.
    const vals = pts.map((v) => v[key] as number)
    const lim = key === 'weight' ? { lo: Math.min(...vals), hi: Math.max(...vals) } : limits[key]
    const bandLo = key2 ? limits[key2].lo : lim.lo
    return (
      <LineChart
        key={key}
        title={title}
        unit={VITALS[key].unit}
        points={points}
        lo={lim.lo}
        hi={lim.hi}
        lo2={key2 ? limits[key2].lo : undefined}
        dec={VITALS[key].dec}
        current={key2 ? `${f(key, last[key])}/${f(key2, last[key2])}` : f(key, last[key])}
        alarm={alarm}
        legend={{ primary: key2 ? 'sys' : undefined, secondary: key2 ? 'dia' : undefined, band: t(key === 'weight' ? 'chart.vitals.span' : 'chart.vitals.reference', { range: `${f(key2 ?? key, bandLo)}–${f(key, lim.hi)}` }) }}
        ariaLabel={t('chart.vitals.chartAria', { title })}
        formatValue={(v) => f(key, v)}
      />
    )
  }
  const charts = [
    chartFor(t('common.vitals.bp'), 'sys', 'dia'),
    chartFor(t('common.vitals.pulse'), 'pulse'),
    chartFor(t('common.vitals.temp'), 'temp'),
    chartFor(t('chart.vitals.spo2Long'), 'spo2'),
    showGlucose ? chartFor(t('common.vitals.glucose'), 'glucose') : null,
    chartFor(t('common.vitals.respRate'), 'respRate'),
    chartFor(t('common.vitals.pain'), 'pain'),
    chartFor(t('common.vitals.weight'), 'weight'),
  ].filter(Boolean)

  const canWrite = can('resident.vitals.write')
  // «Für Visite vormerken» an auffälligen Messungen (PRD §29), Berechtigung wie in der Übersicht
  const canAsk = can('resident.chart.write')
  const who = `${r.lastName} ${r.firstName} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  const visitCell = (v: (typeof recent)[number]) => {
    if (askedIds.has(v.id)) return <span className="tag accent">{t('visit.ask.marked')}</span>
    if (!canAsk || !abnormalKeys(v, limits).length) return null
    return <AskQuestion residentId={r.id} who={who} options={[]} refOption={{ value: 'vital:' + v.id, group: 'vital', label: vitalRefLabel(ctx, v, limits) }} className="linkbtn small" label={t('visit.ask.rowAction')} />
  }
  const visitCol = recent.some((v) => askedIds.has(v.id) || (canAsk && abnormalKeys(v, limits).length > 0))
  return (
    <>
      {canWrite && (
        <>
          <div className="sec-head"><h2 className="sec">{t('chart.vitals.new')}</h2></div>
          <VitalForm
            residentId={r.id}
            who={`${r.lastName} ${r.firstName}`}
            fields={formKeys.map((k) => ({ key: k, label: t('common.vitals.' + k), unit: VITALS[k].unit, min: VITALS[k].min, max: VITALS[k].max, dec: VITALS[k].dec, lo: limits[k].lo, hi: limits[k].hi }))}
          />
        </>
      )}

      <div className="sec-head">
        <h2 className="sec">{t('chart.vitals.last')}</h2>
        <span className="small muted">{t('chart.vitals.abnormalToday', { n: todayAbn })}</span>
      </div>
      {recent.length ? (
        <div className="tablewrap">
          <table className="vt">
            <thead><tr><th>{t('chart.vitals.measurement')}</th>{usedCols.map((c) => <th key={c.key}>{c.label}</th>)}<th>{t('chart.vitals.by')}</th>{visitCol && <th><span className="sr-only">{t('visit.ask.forVisit')}</span></th>}</tr></thead>
            <tbody>
              {recent.map((v) => (
                <tr key={v.id}>
                  <td className="num">{rel(v.at)}</td>
                  {usedCols.map((c) => {
                    if (c.key === 'bp') {
                      const fl = flag('sys', v.sys, limits) || flag('dia', v.dia, limits)
                      return <td key="bp" className={'num' + (fl ? ' ' + fl : '')}>{v.sys != null ? `${f('sys', v.sys)}/${f('dia', v.dia)}` : '–'}</td>
                    }
                    const k = c.key as VitalKey
                    const fl = k === 'weight' ? '' : flag(k, v[k], limits)
                    return <td key={k} className={'num' + (fl ? ' ' + fl : '')}>{f(k, v[k])}</td>
                  })}
                  <td className="small muted">{names.get(v.recordedById)?.short ?? '–'}{v.note ? ` · ${v.note}` : ''}</td>
                  {visitCol && <td>{visitCell(v)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">{t('chart.vitals.none')}</p>}
      <p className="small muted" style={{ margin: 0 }}>{t('chart.vitals.flagLegend')}</p>

      <div className="sec-head"><h2 className="sec">{t('chart.vitals.week')}</h2></div>
      {charts.length ? <div className="charts">{charts}</div> : <p className="empty">{t('chart.vitals.noneWeek')}</p>}

      <Thresholds
        residentId={r.id}
        canEdit={can('resident.careplan.edit')}
        rows={(['sys', 'dia', 'pulse', 'temp', 'spo2', 'glucose', 'respRate', 'pain'] as VitalKey[]).map((k) => ({
          key: k, label: t('common.vitals.' + k), unit: VITALS[k].unit, dec: VITALS[k].dec,
          lo: limits[k].lo, hi: limits[k].hi, orgLo: orgLimits[k].lo, orgHi: orgLimits[k].hi, individual: individual.has(k),
        }))}
      />
    </>
  )
}
