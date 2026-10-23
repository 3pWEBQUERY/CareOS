import { getPortalCtx } from '@/lib/portal/context'
import { portalUpdates, updateAttachments } from '@/lib/portal/data'
import { fmtNum } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'
import { fmtDay, NoAccess, PortalHead, portalPage } from '../ui'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.updates.title') }
}

export default async function PortalUpdatesPage() {
  const p = await portalPage('updates')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('updates')) return <NoAccess p={p} grant />
  const updates = await portalUpdates(p, current, 60)
  const files = await updateAttachments(p.org.id, [...new Set(updates.flatMap((u) => u.fileIds))])
  const byId = new Map(files.map((f) => [f.id, f]))
  return (
    <>
      <PortalHead label={current.resident.unit} title={t('portal.updates.title')} sub={t('portal.updates.sub')} />
      {updates.length ? updates.map((u) => (
        <article key={u.id} id={`u-${u.id}`} className="card portal-update">
          <div className="card-head">
            <h2>{u.title}</h2>
            <span className="small muted mono">{fmtDay(u.publishedAt, locale, t)}</span>
          </div>
          <div className="card-body stack-sm">
            {u.residentId && <span className="tag outline">{t('portal.updates.personal')}</span>}
            <p className="portal-body">{u.body}</p>
            {u.fileIds.some((id) => byId.has(id)) && (
              <ul className="portal-attach">
                {u.fileIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => (
                  <li key={f.id}><a href={`/portal/files/u/${f.id}`} target="_blank" rel="noopener">{f.filename}</a> <span className="small muted">{f.size < 1048576 ? `${fmtNum(f.size / 1024, 0, locale)} KB` : `${fmtNum(f.size / 1048576, 1, locale)} MB`}</span></li>
                ))}
              </ul>
            )}
          </div>
        </article>
      )) : <Empty title={t('portal.updates.none')} />}
    </>
  )
}
