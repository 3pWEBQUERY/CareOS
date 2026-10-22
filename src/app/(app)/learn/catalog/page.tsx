import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { applicableTo, progress } from '@/lib/learn'
import { LearnHead, LearnTabs } from '../LearnTabs'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.learn') + ' · ' + t('learn.tabs.catalog') }
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('learn.read')) return <Forbidden text={t('common.notAllowed')} />
  const { cat } = await searchParams
  const [courses, mine, roles] = await Promise.all([
    db.course.findMany({ where: { orgId: ctx.org.id, published: true }, include: { modules: { select: { id: true, order: true, kind: true } } }, orderBy: [{ mandatory: 'desc' }, { title: 'asc' }] }),
    db.enrollment.findMany({ where: { userId: ctx.user.id } }),
    db.roleAssignment.findMany({ where: { userId: ctx.user.id }, select: { role: { select: { key: true } } } }),
  ])
  const keys = new Set(roles.map((r) => r.role.key))
  const visible = courses.filter((c) => applicableTo(c, keys) || ctx.can('learn.manage'))
  const cats = [...new Set(visible.map((c) => c.category))]
  const list = cat ? visible.filter((c) => c.category === cat) : visible
  const byCourse = new Map(mine.map((e) => [e.courseId, e]))

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <LearnHead title={t('learn.catalog.title')} sub={t('learn.catalog.sub', { n: visible.length })} />
      <LearnTabs ctx={ctx} current="catalog" />
      <div className="scroll">
        <div className="tabpanel">
          {cats.length > 1 && (
            <nav className="chips" aria-label={t('common.filter')}>
              <Link className="chip" href="/learn/catalog" aria-current={!cat ? 'page' : undefined}>{t('common.all')}</Link>
              {cats.map((c) => <Link key={c} className="chip" href={`/learn/catalog?cat=${c}`} aria-current={cat === c ? 'page' : undefined}>{t('learn.cat.' + c)}</Link>)}
            </nav>
          )}
          {list.length ? (
            <div className="grid-3">
              {list.map((c) => {
                const e = byCourse.get(c.id)
                const p = e ? progress(c.modules, e.doneModules) : null
                const kinds = [...new Set(c.modules.map((m) => m.kind))]
                return (
                  <article key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="card-head">
                      <h3>{c.title}</h3>
                      {c.mandatory && <span className="tag outline">{t('learn.mandatory')}</span>}
                    </div>
                    <div className="card-body stack-sm" style={{ flex: 1 }}>
                      <div className="row small muted" style={{ gap: 10 }}>
                        <span>{t('learn.cat.' + c.category)}</span>
                        <span className="mono">{c.estMinutes} {t('common.minutes')}</span>
                        <span>{t('learn.nModules', { n: c.modules.length })}</span>
                        {c.validityMonths && <span>{t('learn.validityShort', { n: c.validityMonths })}</span>}
                      </div>
                      {c.description && <p className="small fg2" style={{ margin: 0 }}>{c.description}</p>}
                      <div className="chips">{kinds.map((k) => <span key={k} className="tag">{t('learn.kind.' + k)}</span>)}</div>
                    </div>
                    <div className="card-foot row-between">
                      <span className="small">
                        {e ? <span className={e.status === 'completed' ? 'ok-text' : e.status === 'expired' ? 'warn-text' : 'fg2'}>{t('learn.status.' + e.status)}{p && e.status !== 'completed' ? ` · ${p.pct} %` : ''}</span> : <span className="muted">{t('learn.catalog.notStarted')}</span>}
                      </span>
                      <Link className="btn sm" href={`/learn/${c.id}`}>{e ? t('learn.open') : t('learn.catalog.view')}</Link>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : <Empty title={t('learn.catalog.empty')} />}
        </div>
      </div>
    </main>
  )
}
