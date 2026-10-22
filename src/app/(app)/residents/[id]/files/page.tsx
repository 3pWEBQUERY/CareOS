import Link from 'next/link'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/env'
import { fileUrl } from '@/lib/files'
import { fmtDate, fmtNum } from '@/lib/time'
import { pageResident, userNames, residentTitle } from '../../_lib/resident'
import { Upload } from './Upload'

const CATEGORIES = ['report', 'lab', 'imaging', 'prescription', 'directive', 'consent', 'insurance', 'other']

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'files')
}

export default async function FilesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cat?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const files = await db.residentFile.findMany({ where: { residentId: r.id, file: { orgId: ctx.org.id } }, include: { file: true }, orderBy: { createdAt: 'desc' } })
  const names = await userNames(ctx, files.map((f) => f.file.uploadedById))
  const cat = sp.cat && CATEGORIES.includes(sp.cat) ? sp.cat : null
  const shown = files.filter((f) => !cat || f.category === cat)
  const size = (b: number) => (b < 1024 * 1024 ? `${fmtNum(b / 1024, 0, locale)} KB` : `${fmtNum(b / 1024 / 1024, 1, locale)} MB`)
  const counts = new Map<string, number>()
  for (const f of files) counts.set(f.category, (counts.get(f.category) ?? 0) + 1)
  const catLabel = (c: string) => t('residents.files.cat.' + (CATEGORIES.includes(c) ? c : 'other'))

  return (
    <>
      {can('resident.chart.write') && (
        <>
          <div className="sec-head"><h2 className="sec">{t('residents.files.upload')}</h2></div>
          {storageConfigured()
            ? <Upload residentId={r.id} categories={CATEGORIES.map((c) => ({ value: c, label: catLabel(c) }))} />
            : <div className="alert warn"><span className="grow"><strong>{t('residents.files.noStorageTitle')}</strong>{t('residents.files.errors.storage_not_configured')}</span></div>}
        </>
      )}
      <div className="sec-head">
        <h2 className="sec">{t('residents.files.title')}</h2>
        {files.length > 0 && (
          <nav className="chips" aria-label={t('common.filter')}>
            <Link className="chip" scroll={false} href={`/residents/${r.id}/files`} aria-current={!cat ? 'page' : undefined}>{t('common.all')} <span className="mono muted">{files.length}</span></Link>
            {CATEGORIES.filter((c) => counts.has(c)).map((c) => (
              <Link key={c} scroll={false} className="chip" href={`/residents/${r.id}/files?cat=${c}`} aria-current={cat === c ? 'page' : undefined}>{catLabel(c)} <span className="mono muted">{counts.get(c)}</span></Link>
            ))}
          </nav>
        )}
      </div>
      {shown.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('residents.files.fTitle')}</th><th>{t('residents.files.fCategory')}</th><th>{t('residents.files.file')}</th><th className="right">{t('residents.files.size')}</th><th>{t('residents.files.date')}</th><th>{t('residents.files.by')}</th></tr></thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id}>
                  <th><a href={fileUrl(f.fileId)} target="_blank" rel="noopener">{f.title}</a></th>
                  <td><span className="tag">{catLabel(f.category)}</span></td>
                  <td className="small"><a href={fileUrl(f.fileId, true)} className="fg2">{f.file.filename}</a></td>
                  <td className="num right small">{size(f.file.size)}</td>
                  <td className="num small nowrap">{fmtDate(f.createdAt, locale)}</td>
                  <td className="small muted">{names.get(f.file.uploadedById)?.short ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">{t('residents.files.none')}</p>}
    </>
  )
}
