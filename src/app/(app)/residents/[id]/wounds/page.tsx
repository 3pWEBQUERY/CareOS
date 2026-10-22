import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { LIVE } from '@/lib/vitals'
import { getCtx, residentInScope } from '@/lib/context'
import { dateKey, fmtDate, startOfDay } from '@/lib/time'
import { keyLabel, WOUND_KINDS, woundArea } from '@/lib/care'
import { Empty } from '@/components/ui/Empty'
import { NewWoundButton } from './WoundClient'
import { StatusTag } from './ui'
import { residentTitle } from '../../_lib/resident'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'wounds')
}

export default async function WoundsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const canWrite = ctx.can('resident.wounds.write', { unitId: r.unitId, locationId: r.unit.locationId })
  const now = new Date()
  const wounds = await db.wound.findMany({
    where: { residentId: r.id },
    orderBy: [{ startedAt: 'desc' }],
    include: { entries: { where: LIVE, orderBy: { at: 'desc' }, take: 1 } },
  })
  const active = wounds.filter((w) => w.status !== 'closed')
  const closed = wounds.filter((w) => w.status === 'closed')
  const contextLabel = `${r.lastName} ${r.firstName}${r.room ? ' · ' + t('care.roomShort', { room: r.room.number }) : ''}`
  const days = (d: Date) => Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000))

  const table = (list: typeof wounds) => (
    <div className="tablewrap">
      <table className="stable">
        <thead>
          <tr>
            <th>{t('care.wounds.colSite')}</th>
            <th>{t('care.wounds.colKind')}</th>
            <th>{t('care.wounds.colStatus')}</th>
            <th>{t('care.wounds.colSince')}</th>
            <th>{t('care.wounds.colSize')}</th>
            <th>{t('care.wounds.colNext')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((w) => {
            const e = w.entries[0]
            const next = e?.nextChange ?? null
            const over = w.status !== 'closed' && next != null && next < now
            const area = e ? woundArea(e.lengthMm, e.widthMm) : null
            return (
              <tr key={w.id} className={'clickable' + (over ? ' over' : '')}>
                <td>
                  <Link href={`/residents/${r.id}/wounds/${w.id}`} style={{ fontWeight: 500 }}>{w.bodySite}</Link>
                </td>
                <td>
                  {keyLabel(t, 'kinds', WOUND_KINDS, w.kind)}
                  {w.classification && <div className="small muted">{w.classification}</div>}
                </td>
                <td><StatusTag status={w.status} label={t('care.wounds.status.' + w.status)} /></td>
                <td className="nowrap">
                  {w.status === 'closed' && w.closedAt
                    ? t('care.wounds.closedOn', { date: fmtDate(w.closedAt, locale) })
                    : t('care.wounds.since', { date: fmtDate(w.startedAt, locale), n: days(w.startedAt) })}
                </td>
                <td className="num nowrap">
                  {e && e.lengthMm != null ? `${e.lengthMm} × ${e.widthMm ?? '–'}${e.depthMm != null ? ' × ' + e.depthMm : ''} mm` : '–'}
                  {area != null && <div className="small muted">{area} mm²</div>}
                </td>
                <td className={'nowrap ' + (over ? 'crit-text' : '')}>
                  {w.status === 'closed' || !next ? <span className="muted">–</span> : <>{over && '▲ '}<span className="mono">{fmtDate(next, locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>{over && ' · ' + t('care.wounds.overdue')}</>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 className="sec">{t('care.wounds.title')}</h2>
          <span className="small muted">{t('care.wounds.subtitle')}</span>
        </div>
        {canWrite && <NewWoundButton residentId={r.id} today={dateKey(now)} contextLabel={contextLabel} />}
      </div>
      {!wounds.length ? (
        <Empty title={t('care.wounds.none')} />
      ) : (
        <>
          {active.length ? table(active) : <p className="small muted" style={{ margin: 0 }}>{t('care.wounds.noneActive')}</p>}
          {closed.length > 0 && (
            <section className="stack-sm" aria-labelledby="w-closed">
              <div className="sec-head"><h2 className="sec" id="w-closed">{t('care.wounds.closedSection')}</h2></div>
              {table(closed)}
            </section>
          )}
        </>
      )}
    </>
  )
}
