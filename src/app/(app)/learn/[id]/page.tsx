import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { Markdown } from '@/lib/markdown'
import { fileUrl } from '@/lib/files'
import { applicableTo, certState, isDone, loadCourse, parseQuiz, progress, staffInScope, syncExpired, unlocked, videoEmbed } from '@/lib/learn'
import { fmtDate } from '@/lib/time'
import { IconFile, IconExternal } from '@/components/icons'
import { completeModule, startCourse } from '../actions'
import { ActBtn } from '../../docs/DocsClient'
import { PracticalConfirm, QuizForm } from '../LearnClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const course = ctx.can('learn.read') ? await loadCourse(ctx, (await params).id) : null
  const visible = course && (course.published || ctx.can('learn.manage'))
  return { title: visible ? `${course.title} · ${t('nav.learn')}` : t('nav.learn') }
}

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('learn.read')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const sp = await searchParams
  const manage = ctx.can('learn.manage')
  const course = await loadCourse(ctx, id)
  if (!course || (!course.published && !manage)) notFound()
  await syncExpired(ctx.org.id, ctx.user.id)
  const now = new Date()
  const [enrollment, cert] = await Promise.all([
    db.enrollment.findUnique({ where: { courseId_userId: { courseId: id, userId: ctx.user.id } } }),
    db.certificate.findFirst({ where: { userId: ctx.user.id, courseId: id }, orderBy: { issuedAt: 'desc' } }),
  ])
  const done = enrollment?.doneModules ?? []
  const mods = course.modules
  const p = progress(mods, done)
  const firstOpen = mods.findIndex((m, i) => !isDone(done, m) && unlocked(mods, done, i))
  const reqIdx = sp.m != null ? Number(sp.m) : NaN
  // Leitungen dürfen jedes Modul ansehen (Vorschau, praktische Nachweise bestätigen).
  const viewable = (i: number) => manage || unlocked(mods, done, i)
  const idx = Number.isInteger(reqIdx) && reqIdx >= 0 && reqIdx < mods.length && viewable(reqIdx) ? reqIdx : firstOpen >= 0 ? firstOpen : 0
  const mod = mods[idx]
  const completed = enrollment?.status === 'completed'
  const over = !completed && enrollment?.dueAt && enrollment.dueAt < now
  const cState = cert ? certState(cert.expiresAt, now) : null
  const nextIdx = mods.findIndex((m, i) => i > idx && !isDone(done, m))

  // Leitung: Personen für praktische Nachweise und Teilnahmeübersicht
  let people: { id: string; name: string }[] = []
  let stats: { enrolled: number; completed: number } | null = null
  if (manage) {
    const [staff, enrollments] = await Promise.all([staffInScope(ctx), db.enrollment.findMany({ where: { courseId: id }, select: { userId: true, status: true, doneModules: true } })])
    stats = { enrolled: enrollments.length, completed: enrollments.filter((e) => e.status === 'completed').length }
    if (mod?.kind === 'practical') {
      const confirmed = new Set(enrollments.filter((e) => isDone(e.doneModules, mod)).map((e) => e.userId))
      people = staff.filter((u) => applicableTo(course, u.roleKeys) && !confirmed.has(u.id)).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}` }))
    }
  }
  const file = mod?.kind === 'document' && mod.fileId ? await db.fileObject.findFirst({ where: { id: mod.fileId, orgId: ctx.org.id }, select: { id: true, filename: true } }) : null
  const quiz = mod?.kind === 'quiz' ? parseQuiz(mod.quiz) : null
  const video = mod?.kind === 'video' ? videoEmbed(mod.videoUrl) : null
  const modDone = mod ? isDone(done, mod) : false

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <span className="lbl"><Link href="/learn" style={{ color: 'inherit' }}>CareOS Learn</Link> · {t('learn.cat.' + course.category)}</span>
          <h1>{course.title} {course.mandatory && <span className="tag outline" style={{ verticalAlign: 3 }}>{t('learn.mandatory')}</span>}</h1>
          <p className="sub">
            {[`${course.estMinutes} ${t('common.minutes')}`, t('learn.nModules', { n: mods.length }), course.validityMonths ? t('learn.validityShort', { n: course.validityMonths }) : t('learn.cert.noExpiry')].join(' · ')}
            {!course.published && ' · ' + t('learn.unpublished')}
          </p>
        </div>
        <div className="row">
          {stats && <span className="small muted">{t('learn.course.stats', { enrolled: stats.enrolled, completed: stats.completed })}</span>}
          {manage && <Link className="btn" href={`/learn/compliance?course=${course.id}`}>{t('learn.tabs.compliance')}</Link>}
          {manage && <Link className="btn" href={`/learn/${course.id}/edit`}>{t('common.edit')}</Link>}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {course.description && !(mods[0]?.body ?? '').startsWith(course.description.slice(0, 60)) && <p className="fg2" style={{ margin: 0, maxWidth: '75ch' }}>{course.description}</p>}

          {completed ? (
            <div className={'alert ' + (cState === 'expiring' ? 'warn' : 'ok')}>
              <div className="grow">
                <strong>{t('learn.course.completed', { date: enrollment!.completedAt ? fmtDate(enrollment!.completedAt, locale) : '–' })}</strong>
                <span>
                  {enrollment!.score != null && t('learn.course.score', { pct: Math.round(enrollment!.score * 100) }) + ' · '}
                  {cert?.expiresAt ? t('learn.course.certUntil', { date: fmtDate(cert.expiresAt, locale) }) : t('learn.cert.noExpiry')}
                </span>
              </div>
              {cState === 'expiring' && <ActBtn className="btn sm" label={t('learn.course.renew')} confirm={t('learn.course.renewConfirm')} context={<strong>{course.title}</strong>} action={startCourse.bind(null, course.id)} />}
              <Link className="btn sm" href="/learn/certificates">{t('learn.tabs.certificates')}</Link>
            </div>
          ) : enrollment?.status === 'expired' ? (
            <div className="alert warn"><div className="grow"><strong>{t('learn.course.expired')}</strong><span>{cert?.expiresAt ? t('learn.course.expiredOn', { date: fmtDate(cert.expiresAt, locale) }) : ''}</span></div><ActBtn className="btn sm primary" label={t('learn.course.restart')} action={startCourse.bind(null, course.id)} /></div>
          ) : enrollment?.dueAt ? (
            <div className={'alert ' + (over ? 'crit' : 'info')}><span className="grow">{t(over ? 'learn.course.overdue' : 'learn.course.due', { date: fmtDate(enrollment.dueAt, locale) })}</span></div>
          ) : null}

          {mods.length > 0 ? (
            <>
              <div className="stack-sm">
                <div className="row-between small"><span className="lbl">{t('learn.course.progress')}</span><span className="mono">{p.done}/{p.total} · {p.pct} %</span></div>
                <div className="bar"><i className={p.pct === 100 ? 'ok' : ''} style={{ width: p.pct + '%' }} /></div>
              </div>
              <ol className="steps" aria-label={t('learn.course.modules')}>
                {mods.map((m, i) => {
                  const st = isDone(done, m) ? 'done' : i === idx ? 'current' : unlocked(mods, done, i) ? 'open' : 'locked'
                  const link = st !== 'locked' || viewable(i)
                  const inner = (
                    <>
                      <span className="n">{i + 1} · {t('learn.kind.' + m.kind)}{st === 'done' ? ' ✓' : st === 'locked' ? ' · ' + t('learn.mstate.locked') : ''}</span>
                      <span>{m.title}</span>
                      {st !== 'locked' && <span className="sr-only">{t('learn.mstate.' + st)}</span>}
                    </>
                  )
                  return (
                    <li key={m.id} data-state={st === 'open' ? undefined : st} aria-current={i === idx ? 'step' : undefined}>
                      {!link ? inner : <Link href={`/learn/${course.id}?m=${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{inner}</Link>}
                    </li>
                  )
                })}
              </ol>

              {mod && (
                <article className="card" aria-labelledby="mod-title">
                  <div className="card-head">
                    <h2 id="mod-title"><span className="tag" style={{ marginRight: 8 }}>{t('learn.kind.' + mod.kind)}</span>{mod.title}</h2>
                    {modDone && <span className="tag ok">{t('learn.mstate.done')}</span>}
                  </div>
                  <div className="card-body stack">
                    {mod.kind === 'video' && (
                      video?.kind === 'iframe' ? <iframe className="video" src={video.src} title={mod.title} allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" />
                        : video?.kind === 'video' ? <video className="video" src={video.src} controls preload="metadata" />
                          : video ? <a className="btn" href={video.src} target="_blank" rel="noopener noreferrer"><IconExternal size={16} /> {t('learn.course.openVideo')}</a>
                            : <p className="muted small" style={{ margin: 0 }}>{t('learn.course.noVideo')}</p>
                    )}
                    {mod.kind === 'document' && (
                      file ? <a className="card li" href={fileUrl(file.id)} target="_blank" rel="noopener"><IconFile size={18} /><span className="grow">{file.filename}</span><span className="small">{t('docs.openFile')}</span></a>
                        : <p className="muted small" style={{ margin: 0 }}>{t('learn.course.noFile')}</p>
                    )}
                    {mod.body && mod.kind !== 'quiz' && <Markdown source={mod.body} />}
                    {mod.kind === 'quiz' && (quiz ? <QuizForm courseId={course.id} moduleId={mod.id} questions={quiz.questions.map((q) => ({ q: q.q, options: q.options }))} pass={quiz.pass} passed={modDone} /> : <p className="muted small">{t('learn.course.quizInvalid')}</p>)}
                    {mod.kind === 'practical' && (
                      <div className={'alert ' + (modDone ? 'ok' : '')}><span className="grow">{modDone ? t('learn.practical.doneSelf') : t('learn.practical.pending')}</span></div>
                    )}
                    {manage && mod.kind === 'practical' && (
                      <section className="stack-sm" aria-labelledby="pc">
                        <h3 className="sub" id="pc">{t('learn.practical.title')}</h3>
                        <PracticalConfirm courseId={course.id} moduleId={mod.id} people={people} />
                      </section>
                    )}
                  </div>
                  {(['text', 'video', 'document'].includes(mod.kind) && !modDone && !completed) || nextIdx >= 0 ? (
                    <div className="card-foot row-between">
                      {['text', 'video', 'document'].includes(mod.kind) && !modDone && !completed
                        ? <ActBtn className="btn primary" label={t('learn.course.markDone')} action={completeModule.bind(null, course.id, mod.id)} />
                        : <span />}
                      {nextIdx >= 0 && (modDone || mod.kind === 'practical') && unlocked(mods, done, nextIdx) && <Link className="btn" href={`/learn/${course.id}?m=${nextIdx}`}>{t('learn.course.next')} →</Link>}
                    </div>
                  ) : null}
                </article>
              )}
            </>
          ) : <p className="empty">{t('learn.course.noModules')}</p>}
        </div>
      </div>
    </main>
  )
}
