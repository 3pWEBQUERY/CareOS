import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { fmtDate } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'

const TAG: Record<string, string> = { critical: 'crit', high: 'warn', low: 'warn', abnormal: 'warn', normal: 'ok' }
const MARK: Record<string, string> = { critical: '▲▲', high: '▲', low: '▼', abnormal: '!', normal: '' }

/**
 * Laborbefunde einer Person (PRD §40, Schnittstelle vorbereitet). Server-Komponente zum Einbinden in die Akte
 * (z. B. Register «Vitalwerte» oder eigenes Register). Daten: LabResult, Import über Labor-Integration bzw. POST /api/v1/labs.
 */
export async function LabResults({ residentId, limit = 50 }: { residentId: string; limit?: number }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, residentId)
  if (!r) return null
  const rows = await db.labResult.findMany({ where: { orgId: ctx.org.id, residentId: r.id }, orderBy: { collectedAt: 'desc' }, take: limit })
  return (
    <section className="card" aria-labelledby="labs-h">
      <div className="card-head"><h2 id="labs-h">{t('platform.labs.title')}</h2></div>
      {rows.length ? (
        <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="stable">
            <thead><tr><th>{t('platform.labs.col.date')}</th><th>{t('platform.labs.col.test')}</th><th className="right">{t('platform.labs.col.value')}</th><th>{t('platform.labs.col.ref')}</th><th>{t('platform.labs.col.flag')}</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td className="num nowrap">{fmtDate(x.collectedAt, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <th scope="row" style={{ fontWeight: 400 }}>{x.name}{x.code && <span className="small muted mono"> {x.code}</span>}</th>
                  <td className="num right"><span className="mono">{x.value}</span> <span className="small muted">{x.unit ?? ''}</span></td>
                  <td className="small muted mono">{x.refRange ?? '–'}</td>
                  <td>{x.flag ? <span className={'tag ' + (TAG[x.flag] ?? '')}>{MARK[x.flag] ? <span aria-hidden="true">{MARK[x.flag]} </span> : null}{t('platform.labs.flags.' + x.flag)}</span> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-body"><Empty title={t('platform.labs.none')}>{t('platform.labs.prepared')}</Empty></div>
      )}
    </section>
  )
}
