import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { loadCourse, parseQuiz } from '@/lib/learn'
import { deleteModule, moveModule } from '../../actions'
import { ActBtn } from '../../../docs/DocsClient'
import { CourseForm, ModuleButton } from '../../LearnClient'

export default async function CourseEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('learn.manage')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const course = await loadCourse(ctx, id)
  if (!course) notFound()
  const [roles, files] = await Promise.all([
    db.role.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } }),
    db.fileObject.findMany({ where: { orgId: ctx.org.id, id: { in: course.modules.map((m) => m.fileId).filter((x): x is string => !!x) } }, select: { id: true, filename: true } }),
  ])
  const fileName = new Map(files.map((f) => [f.id, f.filename]))
  const mods = course.modules

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl"><Link href="/learn/manage" style={{ color: 'inherit' }}>CareOS Learn</Link> · {t('learn.edit.label')}</span>
          <h1>{course.title}</h1>
          <p className="sub">{course.published ? t('learn.published') : t('learn.unpublishedHint')}</p>
        </div>
        <Link className="btn" href={`/learn/${course.id}`}>{t('learn.edit.preview')}</Link>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="grid-2">
            <section className="card" aria-labelledby="cs">
              <div className="card-head"><h2 id="cs">{t('learn.edit.settings')}</h2></div>
              <div className="card-body">
                <CourseForm c={{ id: course.id, title: course.title, description: course.description, category: course.category, mandatory: course.mandatory, validityMonths: course.validityMonths, estMinutes: course.estMinutes, audienceRoles: course.audienceRoles, published: course.published }} roles={roles.map((r) => ({ key: r.key, name: r.name }))} />
              </div>
            </section>

            <section className="card" aria-labelledby="ms">
              <div className="card-head">
                <h2 id="ms">{t('learn.course.modules')} <span className="mono muted">{mods.length}</span></h2>
                <ModuleButton courseId={course.id} label={t('learn.edit.addModule')} className="btn sm primary" />
              </div>
              {mods.length ? (
                <ol className="list" style={{ margin: 0 }}>
                  {mods.map((m, i) => {
                    const quiz = m.kind === 'quiz' ? parseQuiz(m.quiz) : null
                    return (
                      <li key={m.id}>
                        <div className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="mono muted" style={{ width: 18 }}>{i + 1}</span>
                          <div className="grow">
                            <div>{m.title}</div>
                            <div className="small muted">
                              {t('learn.kind.' + m.kind)}
                              {quiz && ' · ' + t('learn.edit.quizSummary', { n: quiz.questions.length, pct: Math.round(quiz.pass * 100) })}
                              {m.kind === 'video' && m.videoUrl && ' · ' + m.videoUrl}
                              {m.kind === 'document' && ' · ' + (m.fileId ? fileName.get(m.fileId) ?? '–' : t('learn.course.noFile'))}
                            </div>
                          </div>
                          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                            <ActBtn className="btn sm ghost" label="↑" disabled={i === 0} action={moveModule.bind(null, course.id, m.id, -1)} />
                            <ActBtn className="btn sm ghost" label="↓" disabled={i === mods.length - 1} action={moveModule.bind(null, course.id, m.id, 1)} />
                            <ModuleButton courseId={course.id} label={t('common.edit')} className="btn sm" m={{ id: m.id, kind: m.kind, title: m.title, body: m.body, videoUrl: m.videoUrl, fileName: m.fileId ? fileName.get(m.fileId) ?? null : null, quiz }} />
                            <ActBtn className="btn sm ghost" label={t('common.delete')} confirm={t('learn.edit.deleteConfirm', { title: m.title })} success="learn.edit.deleted" action={deleteModule.bind(null, course.id, m.id)} />
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : <div className="card-body"><p className="small muted" style={{ margin: 0 }}>{t('learn.course.noModules')}</p></div>}
              <div className="card-foot small muted">{t('learn.edit.orderHint')}</div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
