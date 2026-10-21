import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { LearnHead, LearnTabs } from '../LearnTabs'
import { NewCourseButton } from '../LearnClient'

export const metadata = { title: 'Learn' }

export default async function ManageCoursesPage() {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('learn.manage')) return <Forbidden text={t('common.notAllowed')} />
  const [courses, roles] = await Promise.all([
    db.course.findMany({ where: { orgId: ctx.org.id }, include: { modules: { select: { kind: true } }, enrollments: { select: { status: true } } }, orderBy: [{ published: 'desc' }, { mandatory: 'desc' }, { title: 'asc' }] }),
    db.role.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } }),
  ])
  const roleName = new Map(roles.map((r) => [r.key, r.name]))
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <LearnHead title={t('learn.manage.title')} sub={t('learn.manage.sub', { n: courses.length })} actions={<NewCourseButton roles={roles.map((r) => ({ key: r.key, name: r.name }))} />} />
      <LearnTabs ctx={ctx} current="manage" />
      <div className="scroll">
        <div className="tabpanel">
          {courses.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr><th>{t('learn.col.course')}</th><th>{t('learn.edit.category')}</th><th>{t('learn.col.modules')}</th><th>{t('learn.edit.validity')}</th><th>{t('learn.edit.audience')}</th><th>{t('learn.col.participants')}</th><th>{t('learn.col.status')}</th><th><span className="sr-only">{t('common.edit')}</span></th></tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id}>
                      <td style={{ minWidth: 200 }}><Link href={`/learn/${c.id}`} style={{ fontWeight: 500 }}>{c.title}</Link>{c.mandatory && <> <span className="tag outline">{t('learn.mandatory')}</span></>}</td>
                      <td className="nowrap">{t('learn.cat.' + c.category)}</td>
                      <td className="nowrap"><span className="mono">{c.modules.length}</span> <span className="small muted">{[...new Set(c.modules.map((m) => t('learn.kind.' + m.kind)))].join(', ')}</span></td>
                      <td className="num">{c.validityMonths ? t('learn.validityShort', { n: c.validityMonths }) : '–'}</td>
                      <td className="small">{c.audienceRoles.length ? c.audienceRoles.map((k) => roleName.get(k) ?? k).join(', ') : <span className="muted">{t('learn.edit.everyone')}</span>}</td>
                      <td className="num nowrap">{c.enrollments.filter((e) => e.status === 'completed').length} / {c.enrollments.length}</td>
                      <td><span className={'tag ' + (c.published ? 'ok' : '')}>{c.published ? t('learn.published') : t('learn.unpublished')}</span></td>
                      <td className="nowrap"><Link className="btn sm" href={`/learn/${c.id}/edit`}>{t('common.edit')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('learn.manage.empty')} />}
        </div>
      </div>
    </main>
  )
}
