import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { storageConfigured } from '@/lib/env'
import { fileUrl } from '@/lib/files'
import { dateKey, fmtDate, fmtDayMonth, fmtNum, hm, startOfDay } from '@/lib/time'
import { EDGE, EXUDATE, keyLabel, TISSUE, WOUND_KINDS, WOUND_ORIGINS, woundArea } from '@/lib/care'
import { LineChart } from '@/components/ui/LineChart'
import { Empty } from '@/components/ui/Empty'
import { WoundEntryForm, WoundStatusButtons } from '../WoundClient'
import { StatusTag } from '../ui'

export const metadata = { title: 'CareOS Wounds' }

export default async function WoundDetailPage({ params }: { params: Promise<{ id: string; woundId: string }> }) {
  const { id, woundId } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const w = await db.wound.findFirst({ where: { id: woundId, residentId: r.id }, include: { entries: { orderBy: { at: 'asc' } } } })
  if (!w) notFound()
  const canWrite = ctx.can('resident.wounds.write', { unitId: r.unitId, locationId: r.unit.locationId })
  const now = new Date()
  const authors = new Map(
    (await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set([w.createdById, ...w.entries.map((e) => e.authorId)])] } }, select: { id: true, firstName: true, lastName: true } }))
      .map((u) => [u.id, `${u.firstName.charAt(0)}. ${u.lastName}`]),
  )
  const entries = w.entries
  const last = entries[entries.length - 1]
  const sized = entries.filter((e) => woundArea(e.lengthMm, e.widthMm) != null)
  const firstArea = sized.length ? woundArea(sized[0].lengthMm, sized[0].widthMm)! : null
  const lastArea = sized.length ? woundArea(sized[sized.length - 1].lengthMm, sized[sized.length - 1].widthMm)! : null
  const change = firstArea && lastArea != null && sized.length > 1 ? Math.round(((lastArea - firstArea) / firstArea) * 100) : null
  const next = last?.nextChange ?? null
  const nextOver = w.status !== 'closed' && next != null && next < now
  const lastSized = sized[sized.length - 1]
  const days = Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(w.startedAt).getTime()) / 86_400_000))
  const dt = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="sec-head">
        <div>
          <Link className="linkbtn small" href={`/residents/${r.id}/wounds`}>← {t('care.wounds.back')}</Link>
          <h2 className="sec" style={{ marginTop: 4 }}>{w.bodySite} · {keyLabel(t, 'kinds', WOUND_KINDS, w.kind)} <StatusTag status={w.status} label={t('care.wounds.status.' + w.status)} /></h2>
        </div>
        {canWrite && <WoundStatusButtons residentId={r.id} woundId={w.id} status={w.status} />}
      </div>

      <div className="card">
        <div className="card-body">
          <dl className="kv">
            <dt>{t('care.wounds.bodySite')}</dt><dd>{w.bodySite}</dd>
            <dt>{t('care.wounds.kind')}</dt><dd>{keyLabel(t, 'kinds', WOUND_KINDS, w.kind)}</dd>
            <dt>{t('care.wounds.classification')}</dt><dd>{w.classification ?? '–'}</dd>
            <dt>{t('care.wounds.origin')}</dt><dd>{keyLabel(t, 'origins', WOUND_ORIGINS, w.origin)}</dd>
            <dt>{t('care.wounds.startedAt')}</dt><dd>{t('care.wounds.since', { date: fmtDate(w.startedAt, locale), n: days })} · {authors.get(w.createdById) ?? '–'}</dd>
            {w.closedAt && <><dt>{t('care.wounds.colStatus')}</dt><dd>{t('care.wounds.closedOn', { date: fmtDate(w.closedAt, locale) })}</dd></>}
          </dl>
        </div>
      </div>

      <div className="metrics">
        <div className="metric">
          <span className="lbl">{t('care.wounds.sizeNow')}</span>
          <span className="val">{lastSized ? `${fmtNum(lastSized.lengthMm, 0, locale)} × ${fmtNum(lastSized.widthMm, 0, locale)}${lastSized.depthMm != null ? ' × ' + fmtNum(lastSized.depthMm, 0, locale) : ''}` : '–'} <small>mm</small></span>
          <span className="small muted">{lastSized ? fmtDate(lastSized.at, locale) : t('care.wounds.noEntries')}</span>
        </div>
        <div className="metric">
          <span className="lbl">{t('care.wounds.areaNow')}</span>
          <span className={'val' + (change != null && change > 0 ? ' crit' : change != null && change < 0 ? ' ok' : '')}>{lastArea ?? '–'} <small>mm²</small></span>
          <span className={'small ' + (change != null && change > 0 ? 'crit-text' : 'muted')}>
            {change != null ? t('care.wounds.sizeChange', { dir: change > 0 ? '▲' : change < 0 ? '▼' : '=', pct: Math.abs(change) }) : '–'}
          </span>
        </div>
        <div className="metric">
          <span className="lbl">{t('care.wounds.painNow')}</span>
          <span className={'val' + (last?.pain != null && last.pain >= 4 ? ' warn' : '')}>{last?.pain ?? '–'} <small>NRS</small></span>
        </div>
        <div className="metric">
          <span className="lbl">{t('care.wounds.nextNow')}</span>
          <span className={'val' + (nextOver ? ' crit' : '')} style={{ fontSize: 16 }}>{next && w.status !== 'closed' ? `${fmtDayMonth(next)} ${hm(next)}` : '–'}</span>
          <span className={'small ' + (nextOver ? 'crit-text' : 'muted')}>{nextOver ? '▲ ' + t('care.wounds.overdue') : !next || w.status === 'closed' ? t('care.wounds.noNext') : ''}</span>
        </div>
      </div>

      <div className="grid-2">
        {sized.length > 0 ? (
          <LineChart
            title={t('care.wounds.chartTitle')}
            unit="mm²"
            points={sized.slice(-12).map((e) => ({ label: fmtDayMonth(e.at), title: `${fmtDate(e.at, locale)}: ${woundArea(e.lengthMm, e.widthMm)} mm² (${e.lengthMm} × ${e.widthMm} mm)`, v: woundArea(e.lengthMm, e.widthMm) }))}
            lo={0} hi={firstArea ?? 0}
            current={String(lastArea ?? '–')}
            alarm={change != null && change > 0}
            legend={{ primary: t('care.wounds.areaNow'), band: t('care.wounds.chartBand', { n: firstArea ?? 0 }) }}
            ariaLabel={t('care.wounds.chartAria')}
          />
        ) : <Empty title={t('care.wounds.noEntries')} />}
        {canWrite && w.status !== 'closed' && (
          <section className="card" aria-labelledby="we-h">
            <div className="card-head"><h3 id="we-h">{t('care.wounds.entryNew')}</h3></div>
            <div className="card-body">
              <WoundEntryForm residentId={r.id} woundId={w.id} now={`${dateKey(now)}T${hm(now)}`} storage={storageConfigured()} />
            </div>
          </section>
        )}
      </div>

      <section className="stack-sm" aria-labelledby="wh-h">
        <div className="sec-head">
          <h2 className="sec" id="wh-h">{t('care.wounds.history')}</h2>
          <span className="small muted">{t('care.wounds.entries', { n: entries.length })}</span>
        </div>
        {entries.length ? (
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr>
                  <th>{t('care.wounds.colAt')}</th>
                  <th>{t('care.wounds.colMeasure')}</th>
                  <th className="right">{t('care.wounds.colArea')}</th>
                  <th>{t('care.wounds.colFindings')}</th>
                  <th className="right">{t('care.wounds.colPain')}</th>
                  <th>{t('care.wounds.colTreatment')}</th>
                  <th>{t('care.wounds.colNext')}</th>
                  <th>{t('care.wounds.colPhotos')}</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => {
                  const a = woundArea(e.lengthMm, e.widthMm)
                  return (
                    <tr key={e.id}>
                      <td className="nowrap"><span className="mono">{dt(e.at)}</span><div className="small muted">{authors.get(e.authorId) ?? '–'}</div></td>
                      <td className="num nowrap">{e.lengthMm != null ? `${e.lengthMm} × ${e.widthMm ?? '–'} × ${e.depthMm ?? '–'}` : '–'}</td>
                      <td className="num right nowrap">{a != null ? `${a} mm²` : '–'}</td>
                      <td style={{ minWidth: 180 }}>
                        <div className="small">
                          <span className="muted">{t('care.wounds.exudateL')}:</span> {keyLabel(t, 'exudate', EXUDATE, e.exudate)} · <span className="muted">{t('care.wounds.tissueL')}:</span> {keyLabel(t, 'tissue', TISSUE, e.tissue)} · <span className="muted">{t('care.wounds.edgeL')}:</span> {keyLabel(t, 'edge', EDGE, e.edge)}
                        </div>
                        {e.description && <div className="small fg2 ws-pre" style={{ marginTop: 2 }}>{e.description}</div>}
                      </td>
                      <td className="num right">{e.pain ?? '–'}</td>
                      <td style={{ minWidth: 180 }}>
                        <div className="small">{e.treatment ?? '–'}</div>
                        {e.material && <div className="small muted">{e.material}</div>}
                      </td>
                      <td className="num nowrap">{e.nextChange ? `${fmtDayMonth(e.nextChange)} ${hm(e.nextChange)}` : '–'}</td>
                      <td>
                        {e.photoIds.length ? (
                          <div className="thumbs">
                            {e.photoIds.map((pid) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <a key={pid} href={fileUrl(pid)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(pid)} alt={t('care.wounds.photoAlt', { date: fmtDate(e.at, locale) })} loading="lazy" /></a>
                            ))}
                          </div>
                        ) : <span className="muted">–</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty title={t('care.wounds.noEntries')} />}
      </section>
    </>
  )
}
