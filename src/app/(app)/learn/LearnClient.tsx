'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Dialog } from '@/components/ui/Dialog'
import { toast } from '@/components/toast'
import { assignCourse, confirmPractical, saveCourse, saveModule, submitQuiz, type QuizResult } from './actions'
import { Checkbox, DateField, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'

const tr = (t: (k: string) => string, s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)

export const COURSE_CATS = ['general', 'clinical', 'hygiene', 'safety', 'emergency', 'communication', 'hr'] as const
export const KINDS = ['text', 'video', 'document', 'quiz', 'practical'] as const

// ── Quiz (Teilnahme) ──

export function QuizForm({ courseId, moduleId, questions, pass, passed }: { courseId: string; moduleId: string; questions: { q: string; options: string[] }[]; pass: number; passed: boolean }) {
  const t = useT()
  const ref = useRef<HTMLFormElement>(null)
  const resRef = useRef<HTMLDivElement>(null)
  const [res, setRes] = useState<QuizResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Set<number>>(new Set())
  const [missing, setMissing] = useState<Set<number>>(new Set())
  const [pending, start] = useTransition()
  const wrong = new Set(res?.wrong ?? [])
  const focusQ = (i: number) => ref.current?.querySelector<HTMLInputElement>(`input[name="q${i}"]`)?.focus()
  return (
    <form
      ref={ref}
      className="form"
      noValidate
      aria-labelledby="mod-title"
      onChange={(e) => {
        const name = (e.target as unknown as HTMLInputElement).name
        if (!/^q\d+$/.test(name)) return
        const i = Number(name.slice(1))
        setAnswered((cur) => new Set(cur).add(i))
        setMissing((cur) => { if (!cur.has(i)) return cur; const n = new Set(cur); n.delete(i); return n })
      }}
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const open = questions.map((_, i) => i).filter((i) => !form.has('q' + i))
        if (open.length) {
          setMissing(new Set(open))
          setErr(t('learn.ux.unanswered', { list: open.map((i) => i + 1).join(', ') }))
          focusQ(open[0])
          return
        }
        setMissing(new Set())
        start(async () => {
          const r = await submitQuiz(courseId, moduleId, form)
          if (r.ok && r.data) {
            setRes(r.data)
            setErr(null)
            if (r.data.passed) toast(t('learn.quiz.passedToast'))
            requestAnimationFrame(() => { resRef.current?.focus(); resRef.current?.scrollIntoView({ block: 'nearest' }) })
          } else if (!r.ok) setErr(tr(t, r.error))
        })
      }}
    >
      {passed && !res && <div className="alert ok"><span className="grow">{t('learn.quiz.alreadyPassed')}</span></div>}
      <ol className="stack" style={{ margin: 0, padding: 0, listStyle: 'none', maxWidth: 760 }}>
        {questions.map((q, i) => {
          const isWrong = !!res && !res.passed && wrong.has(i)
          const isMissing = missing.has(i)
          return (
            <li key={i}>
              <fieldset className="quiz-q" data-state={isWrong ? 'wrong' : isMissing ? 'missing' : undefined} disabled={pending || !!res?.passed} aria-describedby={isWrong || isMissing ? `qh${i}` : undefined}>
                <legend><span className="mono muted">{i + 1}.</span> {q.q}</legend>
                <div className="stack-sm">
                  {q.options.map((o, j) => (
                    <label key={j} className="opt"><input type="radio" name={'q' + i} value={j} /> <span>{o}</span></label>
                  ))}
                </div>
                {isWrong && <p id={`qh${i}`} className="small crit-text" style={{ margin: '6px 0 0' }}>✕ {t('learn.quiz.wrong')}</p>}
                {isMissing && !isWrong && <p id={`qh${i}`} className="small crit-text" style={{ margin: '6px 0 0' }}>{t('learn.ux.pick')}</p>}
              </fieldset>
            </li>
          )
        })}
      </ol>
      {res && (
        <div ref={resRef} tabIndex={-1} className={'alert ' + (res.passed ? 'ok' : 'crit')} role="status">
          <div className="grow">
            <strong>{res.passed ? '✓ ' + t('learn.quiz.passed') : '✕ ' + t('learn.quiz.failed')}</strong>
            <span>{t('learn.quiz.result', { right: questions.length - res.wrong.length, total: questions.length, pct: Math.round(res.score * 100), pass: Math.round(res.pass * 100) })}</span>
          </div>
        </div>
      )}
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="form-actions">
        <span className="small muted">
          {!res && <span className="mono">{t('learn.ux.answered', { n: answered.size, total: questions.length })}</span>}
          {!res && ' · '}
          {t('learn.quiz.passMark', { pct: Math.round(pass * 100) })}
        </span>
        <span className="spacer" />
        {res && !res.passed ? (
          <button type="button" className="btn primary" onClick={() => { ref.current?.reset(); setRes(null); setAnswered(new Set()); requestAnimationFrame(() => focusQ(0)) }}>{t('learn.quiz.retry')}</button>
        ) : !res?.passed && (
          <button type="submit" className="btn primary" disabled={pending} data-loading={pending || undefined}>{t('learn.quiz.submit')}</button>
        )}
      </div>
    </form>
  )
}

// ── Praktischer Nachweis ──

export function PracticalConfirm({ courseId, moduleId, people }: { courseId: string; moduleId: string; people: { id: string; name: string }[] }) {
  const t = useT()
  if (!people.length) return <p className="small muted" style={{ margin: 0 }}>{t('learn.practical.allConfirmed')}</p>
  return (
    <ActionForm action={confirmPractical.bind(null, courseId, moduleId)} className="form">
      <div className="form-grid">
        <Select label={t('learn.practical.person')} name="userId" required defaultValue="">
            <option value="" disabled>{t('learn.practical.choose')}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        <TextField label={<>{t('learn.practical.note')} <span className="muted">({t('common.optional')})</span></>} name="note" maxLength={200} />
      </div>
      <div className="form-actions"><span className="small muted">{t('learn.practical.hint')}</span><span className="spacer" /><Submit>{t('learn.practical.confirm')}</Submit></div>
    </ActionForm>
  )
}

// ── Zuweisung ──

export function AssignButton({ courses, people, roles, units, defaultCourse }: {
  courses: { id: string; title: string }[]
  people: { id: string; name: string; unit: string | null }[]
  roles: { id: string; name: string }[]
  units: { id: string; name: string }[]
  defaultCourse?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'users' | 'role' | 'unit'>('users')
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => people.filter((p) => !filter || (p.name + ' ' + (p.unit ?? '')).toLowerCase().includes(filter.toLowerCase())), [people, filter])
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('learn.assign.button')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('learn.assign.title')} wide>
        <ActionForm action={assignCourse} onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name="mode" value={mode} />
          <div className="form-grid">
            <Select label={t('learn.assign.course')} name="courseId" defaultValue={defaultCourse ?? courses[0]?.id}>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            <DateField label={t('learn.assign.due')} name="dueAt" />
          </div>
          <div className="stack-sm">
            <span className="lbl">{t('learn.assign.to')}</span>
            <div className="seg" role="group" aria-label={t('learn.assign.to')} style={{ alignSelf: 'flex-start' }}>
              {(['users', 'role', 'unit'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{t('learn.assign.mode.' + m)}</button>)}
            </div>
          </div>
          {mode === 'users' && (
            <div className="stack-sm">
              <TextField type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('learn.assign.filter')} aria-label={t('learn.assign.filter')} />
              <div className="card" style={{ maxHeight: 260, overflow: 'auto', padding: '4px 10px' }}>
                {people.map((p) => (
                  <label key={p.id} className="check" style={{ display: shown.includes(p) ? 'flex' : 'none', minHeight: 36 }}>
                    <input type="checkbox" name="userIds" value={p.id} /> <span className="grow">{p.name}</span>{p.unit && <span className="small muted">{p.unit}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}
          {mode === 'role' && (
            <Select label={t('learn.assign.role')} name="roleId">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          )}
          {mode === 'unit' && (
            <Select label={t('learn.assign.unit')} name="unitId">{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          )}
          <Checkbox name="renew" label={t('learn.assign.renew')} />
          <div className="form-actions"><span className="small muted">{t('learn.assign.hint')}</span><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('learn.assign.submit')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

// ── Kurs-Editor ──

export type CourseData = { id?: string; title: string; description: string | null; category: string; mandatory: boolean; validityMonths: number | null; estMinutes: number; audienceRoles: string[]; published: boolean }

export function CourseFields({ c, roles }: { c?: CourseData; roles: { key: string; name: string }[] }) {
  const t = useT()
  return (
    <>
      {c?.id && <input type="hidden" name="id" value={c.id} />}
      <div className="form-grid">
        <TextField label={t('learn.edit.title')} wrapClassName="span-all" name="title" defaultValue={c?.title} required maxLength={200} />
        <Select label={t('learn.edit.category')} name="category" defaultValue={c?.category ?? 'general'}>{COURSE_CATS.map((k) => <option key={k} value={k}>{t('learn.cat.' + k)}</option>)}</Select>
        <TextField label={t('learn.edit.minutes')} name="estMinutes" inputMode="numeric" defaultValue={c?.estMinutes ?? 30} className="mono" />
        <TextField label={t('learn.edit.validity')} name="validityMonths" inputMode="numeric" defaultValue={c?.validityMonths ?? ''} placeholder={t('learn.edit.validityHint')} className="mono" />
        <Textarea label={t('learn.edit.description')} wrapClassName="span-all" name="description" rows={3} defaultValue={c?.description ?? ''} />
      </div>
      <div className="row">
        <Checkbox name="mandatory" defaultChecked={c?.mandatory} label={t('learn.edit.mandatory')} />
        <Checkbox name="published" defaultChecked={c?.published ?? false} label={t('learn.edit.published')} />
      </div>
      <fieldset>
        <legend className="lbl">{t('learn.edit.audience')}</legend>
        <p className="small muted" style={{ margin: '0 0 6px' }}>{t('learn.edit.audienceHint')}</p>
        <div className="row" style={{ gap: '4px 16px' }}>
          {roles.map((r) => <label key={r.key} className="check"><input type="checkbox" name="audienceRoles" value={r.key} defaultChecked={c?.audienceRoles.includes(r.key)} /> {r.name}</label>)}
        </div>
      </fieldset>
    </>
  )
}

export function NewCourseButton({ roles }: { roles: { key: string; name: string }[] }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('learn.edit.new')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('learn.edit.new')} wide>
        <ActionForm action={saveCourse} success="learn.edit.created" onDone={(r) => { if (r.ok) { setOpen(false); router.push(`/learn/${(r.data as { id: string }).id}/edit`) } }}>
          <CourseFields roles={roles} />
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.create')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

export function CourseForm({ c, roles }: { c: CourseData; roles: { key: string; name: string }[] }) {
  const t = useT()
  return (
    <ActionForm action={saveCourse} success="common.saved" reset={false}>
      <CourseFields c={c} roles={roles} />
      <div className="form-actions"><span className="spacer" /><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}

type Q = { q: string; options: string[]; answer: number }
export type ModuleData = { id?: string; kind: string; title: string; body: string | null; videoUrl: string | null; fileName: string | null; quiz: { pass: number; questions: Q[] } | null }

/** Quiz-Baukasten: Fragen, Antwortoptionen, richtige Antwort, Bestehensgrenze. */
function QuizBuilder({ initial }: { initial: ModuleData['quiz'] }) {
  const t = useT()
  const [pass, setPass] = useState(Math.round((initial?.pass ?? 0.8) * 100))
  const [qs, setQs] = useState<Q[]>(initial?.questions?.length ? initial.questions : [{ q: '', options: ['', ''], answer: 0 }])
  const upd = (i: number, f: (q: Q) => Q) => setQs((cur) => cur.map((q, j) => (j === i ? f(q) : q)))
  const json = JSON.stringify({ pass: Math.min(100, Math.max(1, pass)) / 100, questions: qs })
  return (
    <div className="stack-sm">
      <input type="hidden" name="quiz" value={json} />
      <NumberField label={t('learn.edit.passMark')} wrapStyle={{ maxWidth: 220 }} min={1} max={100} value={pass} onChange={(v) => setPass(v === '' ? 0 : v)} step={1} />
      {qs.map((q, i) => (
        <fieldset key={i} className="stack-sm">
          <legend className="lbl">{t('learn.edit.question', { n: i + 1 })}</legend>
          <TextField value={q.q} onChange={(e) => upd(i, (x) => ({ ...x, q: e.target.value }))} placeholder={t('learn.edit.questionText')} aria-label={t('learn.edit.questionText')} />
          {q.options.map((o, j) => (
            <div key={j} className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="check" title={t('learn.edit.correct')}>
                <input type="radio" name={`correct-${i}`} checked={q.answer === j} onChange={() => upd(i, (x) => ({ ...x, answer: j }))} aria-label={`${t('learn.edit.correct')}: ${t('learn.edit.option', { n: j + 1 })}`} />
              </label>
              <TextField value={o} onChange={(e) => upd(i, (x) => ({ ...x, options: x.options.map((y, k) => (k === j ? e.target.value : y)) }))} placeholder={t('learn.edit.option', { n: j + 1 })} aria-label={t('learn.edit.option', { n: j + 1 })} className="grow" />
              <button type="button" className="btn sm ghost" disabled={q.options.length <= 2} onClick={() => upd(i, (x) => ({ ...x, options: x.options.filter((_, k) => k !== j), answer: x.answer === j ? 0 : x.answer > j ? x.answer - 1 : x.answer }))} aria-label={t('common.delete')}>−</button>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn sm" disabled={q.options.length >= 6} onClick={() => upd(i, (x) => ({ ...x, options: [...x.options, ''] }))}>{t('learn.edit.addOption')}</button>
            <span className="spacer grow" />
            <button type="button" className="btn sm ghost danger" disabled={qs.length <= 1} onClick={() => setQs((cur) => cur.filter((_, k) => k !== i))}>{t('learn.edit.removeQuestion')}</button>
          </div>
        </fieldset>
      ))}
      <div><button type="button" className="btn sm" onClick={() => setQs((cur) => [...cur, { q: '', options: ['', ''], answer: 0 }])}>{t('learn.edit.addQuestion')}</button></div>
      <p className="small muted" style={{ margin: 0 }}>{t('learn.edit.correctHint')}</p>
    </div>
  )
}

export function ModuleButton({ courseId, m, label, className = 'btn' }: { courseId: string; m?: ModuleData; label: string; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(m?.kind ?? 'text')
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={m ? t('learn.edit.editModule') : t('learn.edit.addModule')} wide>
        <ActionForm action={saveModule} success="common.saved" reset={!m} onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name="courseId" value={courseId} />
          {m?.id && <input type="hidden" name="moduleId" value={m.id} />}
          <div className="form-grid">
            <Select label={t('learn.edit.kind')} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{t('learn.kind.' + k)}</option>)}</Select>
            <TextField label={t('learn.edit.moduleTitle')} name="title" defaultValue={m?.title} required maxLength={200} />
          </div>
          {kind === 'video' && <TextField label={t('learn.edit.videoUrl')} hint={t('learn.edit.videoHint')} name="videoUrl" type="url" defaultValue={m?.videoUrl ?? ''} placeholder="https://" />}
          {kind === 'document' && (
            <label className="fld"><span className="lbl">{t('learn.edit.file')}</span><input className="field" type="file" name="file" />{m?.fileName && <span className="hint">{t('learn.edit.currentFile', { name: m.fileName })}</span>}</label>
          )}
          {kind === 'quiz' ? <QuizBuilder initial={m?.quiz ?? null} /> : (
            <Textarea label={kind === 'practical' ? t('learn.edit.practicalBody') : t('learn.edit.body')} hint={t('docs.f.bodyHint')} name="body" rows={kind === 'text' ? 12 : 5} defaultValue={m?.body ?? ''} />
          )}
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.save')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}
