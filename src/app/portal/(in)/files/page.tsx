import { getPortalCtx } from '@/lib/portal/context'
import { portalFiles } from '@/lib/portal/data'
import { fmtNum } from '@/lib/time'
import { Empty } from '@/components/ui/Empty'
import { fmtShortDate, NoAccess, PortalHead, portalPage } from '../ui'

export async function generateMetadata() {
  return { title: (await getPortalCtx()).t('portal.nav.files') }
}

export default async function PortalFiles() {
  const p = await portalPage('files')
  const { t, locale, current } = p
  if (!current) return <NoAccess p={p} />
  if (!p.can('files')) return <NoAccess p={p} grant />
  const files = await portalFiles(p, current)
  const size = (b: number) => (b < 1024 * 1024 ? `${fmtNum(b / 1024, 0, locale)} KB` : `${fmtNum(b / 1024 / 1024, 1, locale)} MB`)
  return (
    <>
      <PortalHead label={p.self ? undefined : `${current.resident.firstName} ${current.resident.lastName}`} title={t('portal.files.title')} sub={t('portal.files.sub')} />
      {files.length ? (
        <section className="card" aria-label={t('portal.files.title')}>
          <ul className="list">
            {files.map((f) => (
              <li key={f.id}>
                <a className="li" href={`/portal/files/${f.id}`} target="_blank" rel="noopener">
                  <div className="grow">
                    <div>{f.title}</div>
                    <div className="small muted">{fmtShortDate(f.createdAt, locale)} · {size(f.size)}</div>
                  </div>
                  <span className="small linkbtn">{t('portal.files.open')}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : <Empty title={t('portal.files.none')} />}
    </>
  )
}
