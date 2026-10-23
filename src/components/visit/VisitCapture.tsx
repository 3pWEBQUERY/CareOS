'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/toast'
import { completeVisit, type CompleteVisitInput } from '@/app/(app)/tasks/visit/actions'
import type { ActionResult } from '@/lib/action'
import { defaultDue, isEmptyVisit, ORDER_KINDS, type OrderKind } from '@/lib/visit'
import { fmtDayMonth, hm } from '@/lib/time'
import { setVisitDirty, useGuardedNav } from './VisitList'
import type { VisitQuestionDto } from './types'
import { DateField, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'

type OrderRow = { key: number; kind: OrderKind; text: string; date: string; time: string; questionId: string | null }

/**
 * Erfassung während der Visite (rechts bzw. unten): Antwort je vorgemerkter Frage, strukturierte Anordnungen
 * (daraus werden Aufgaben), Notiz. «Visite abschliessen» schreibt alles in einem Schritt und geht zur nächsten Person.
 */
export function VisitCapture({ residentId, name, who, physician: initialPhysician, appointmentId, questions, readOnly, documented, next, todayKey, action = completeVisit, physicianFixed = false }: {
  residentId: string
  name: string
  who: string
  physician: string
  appointmentId: string | null
  questions: VisitQuestionDto[]
  readOnly: boolean
  /** Heute bereits dokumentiert: Erfassung erst nach «Nachtrag erfassen» (keine versehentliche Doppelvisite). */
  documented: boolean
  next: { href: string; label: string } | null
  todayKey: string
  /** Abschluss-Action (Ärzteportal: eigene Action mit Zuordnungsprüfung) */
  action?: (residentId: string, input: CompleteVisitInput) => Promise<ActionResult<{ visitId: string; tasks: number }>>
  /** Ärztin/Arzt steht fest (Konto im Ärzteportal): kein Freitextfeld */
  physicianFixed?: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const id = useId()
  const [physician, setPhysician] = useState(initialPhysician)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [note, setNote] = useState('')
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [pending, start] = useTransition()
  const [now, setNow] = useState<Date | null>(null)
  const [collapsed, setCollapsed] = useState(documented && questions.length === 0)
  const [ask, confirmDialog] = useConfirm()
  const [go, navDialog] = useGuardedNav()
  const seq = useRef(0)
  const focusKey = useRef<number | null>(null)

  const isDirty = Object.values(answers).some((a) => a.trim()) || orders.some((o) => o.text.trim()) || !!note.trim()
  useEffect(() => { setVisitDirty(isDirty, name) }, [isDirty, name])
  useEffect(() => () => setVisitDirty(false), [])
  useEffect(() => {
    setNow(new Date())
    const h = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(h)
  }, [])
  useEffect(() => {
    if (!isDirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [isDirty])
  useEffect(() => {
    if (focusKey.current == null) return
    const el = document.getElementById(`${id}o${focusKey.current}t`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
    focusKey.current = null
  }, [orders, id])

  const addOrder = (questionId: string | null = null, kind: OrderKind = 'other') => {
    const key = ++seq.current
    focusKey.current = key
    setOrders((cur) => [...cur, { key, kind, text: '', date: '', time: '', questionId }])
  }
  const patch = (key: number, p: Partial<OrderRow>) => {
    setOrders((cur) => cur.map((o) => (o.key === key ? { ...o, ...p } : o)))
    if (err) setErr(null)
  }
  const filled = orders.filter((o) => o.text.trim())
  const fieldErr = (f: string) => (err?.field === f ? err.msg : null)

  const submit = async () => {
    if (pending) return
    // Leere Anordnungszeilen (ohne Text, Datum, Uhrzeit) werden ignoriert
    const sent = orders.filter((o) => o.text.trim() || o.date || o.time)
    const payload = {
      physician, note, appointmentId,
      answers: questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? '' })),
      orders: sent.map(({ kind, text, date, time, questionId }) => ({ kind, text, date, time, questionId })),
    }
    if (isEmptyVisit({ answers: payload.answers, orders: payload.orders, note }) && !(await ask({ ...splitQuestion(t('visit.capture.emptyConfirm')), context: <span>{who}</span>, confirmLabel: t('visit.capture.complete') }))) return
    start(async () => {
      const r = await action(residentId, payload)
      if (!r.ok) {
        // Feldpfad «orders.<i>.<feld>» auf die Zeile der Anzeige abbilden
        const m = r.field?.match(/^orders\.(\d+)\.(\w+)$/)
        const field = m ? `o${sent[Number(m[1])]?.key}.${m[2]}` : r.field
        setErr({ msg: t(r.error), field })
        const el = m ? document.getElementById(`${id}o${sent[Number(m[1])]?.key}${m[2] === 'text' ? 't' : m[2] === 'date' ? 'd' : 'h'}`) : null
        // Fokus aufs Feld, mittig sichtbar (nicht unter der klebenden Fusszeile, WCAG 2.4.11)
        el?.focus({ preventScroll: true })
        el?.scrollIntoView({ block: 'center' })
        return
      }
      setVisitDirty(false)
      toast(r.message ?? '')
      setAnswers({})
      setOrders([])
      setNote('')
      if (next) void go(next.href)
    })
  }

  return (
    <section className="visit-cap" aria-labelledby={id + 'h'}>
      <h2 className="sec" id={id + 'h'}>{t('visit.capture.title')}</h2>
      {readOnly && <div className="alert info"><span className="grow">{t('visit.capture.readOnly')}</span></div>}
      {!readOnly && collapsed && (
        <div className="stack-sm">
          <p className="small muted" style={{ margin: 0 }}>{t('visit.capture.noQuestions')}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setCollapsed(false)}>{t('visit.capture.again')}</button>
            {next && <GuardedNext href={next.href} label={t('visit.next', { label: next.label })} />}
          </div>
        </div>
      )}
      {!collapsed && <>
      {!readOnly && !physicianFixed && (
        <TextField label={t('visit.capture.physician')} id={id + 'p'} value={physician} maxLength={120} autoComplete="off" onChange={(e) => setPhysician(e.target.value)} />
      )}

      <div className="stack-sm">
        <h3 className="visit-h3">{t('visit.capture.questions')}{questions.length > 0 && <span className="pill">{questions.length}</span>}</h3>
        {questions.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('visit.capture.noQuestions')}</p>}
        {questions.map((q) => (
          <div key={q.id} className="vq">
            <p className="vq-text">{q.text}</p>
            <div className="small muted vq-meta">
              {q.ref && <Link className="linkbtn small" href={q.ref.href}>{q.ref.label}</Link>}
              <span>{t('visit.overview.askedBy', { by: q.by, when: q.when })}</span>
            </div>
            {!readOnly && (
              <>
                <Textarea label={t('visit.capture.answer')} hint={t('visit.capture.answerHint')} id={`${id}a${q.id}`} rows={2} maxLength={2000} autoGrow value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))} />
                <div><button type="button" className="btn sm" onClick={() => addOrder(q.id)}>+ {t('visit.capture.orderFor')}</button></div>
              </>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="stack-sm">
          <h3 className="visit-h3">{t('visit.capture.orders')}{filled.length > 0 && <span className="pill">{filled.length}</span>}</h3>
          {orders.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('visit.capture.noOrders')}</p>}
          {orders.map((o, i) => {
            const q = o.questionId ? questions.find((x) => x.id === o.questionId) : null
            const base = `${id}o${o.key}`
            const due = now ? defaultDue(o.kind, now) : null
            const errText = fieldErr(`o${o.key}.text`)
            const errDue = fieldErr(`o${o.key}.date`) ?? fieldErr(`o${o.key}.time`)
            return (
              <fieldset key={o.key} className="vo">
                <legend className="sr-only">{t('visit.capture.text')} {i + 1}</legend>
                {q && <p className="small muted vo-for">{t('visit.capture.forQuestion', { text: q.text })}</p>}
                <div className="vo-grid">
                  <Select label={t('visit.capture.kind')} wrapClassName="vo-kind" id={base + 'k'} value={o.kind} onChange={(e) => patch(o.key, { kind: e.target.value as OrderKind })}>
                      {ORDER_KINDS.map((k) => <option key={k} value={k}>{t('visit.kinds.' + k)}</option>)}
                    </Select>
                  <TextField label={t('visit.capture.text')} wrapClassName="vo-text" id={base + 't'} value={o.text} maxLength={500} autoComplete="off" aria-invalid={!!errText || undefined} aria-describedby={errText ? base + 'e' : undefined}
                      onChange={(e) => patch(o.key, { text: e.target.value })} />
                  <DateField label={t('visit.capture.date')} wrapClassName="vo-date" id={base + 'd'} min={todayKey} value={o.date} aria-invalid={!!fieldErr(`o${o.key}.date`) || undefined} onChange={(v) => patch(o.key, { date: v })} />
                  <TimeField label={t('visit.capture.time')} wrapClassName="vo-time" id={base + 'h'} step={300} value={o.time} aria-invalid={!!fieldErr(`o${o.key}.time`) || undefined} onChange={(v) => patch(o.key, { time: v })} />
                  <button type="button" className="btn ghost vo-del" aria-label={`${t('visit.capture.remove')} ${i + 1}`} title={t('visit.capture.remove')} onClick={() => setOrders((cur) => cur.filter((x) => x.key !== o.key))}>
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
                {(errText || errDue) && <p className="err" id={base + 'e'} role="alert" style={{ margin: 0 }}>{errText ?? errDue}</p>}
                {!o.date && !o.time && due && <p className="small muted" style={{ margin: 0 }}>{t('visit.capture.dueDefault', { when: `${fmtDayMonth(due, locale)} ${hm(due)}` })}</p>}
                {o.kind === 'medication' && <p className="small vo-med" style={{ margin: 0 }}>{t('visit.capture.medHint')}</p>}
              </fieldset>
            )
          })}
          <div className="row">
            <button type="button" className="btn" onClick={() => addOrder()}>+ {t('visit.capture.addOrder')}</button>
          </div>
        </div>
      )}

      {!readOnly && (
        <Textarea label={t('visit.capture.note')} optional id={id + 'n'} rows={3} maxLength={4000} value={note} placeholder={t('visit.capture.noteHint')} onChange={(e) => setNote(e.target.value)} />
      )}

      {!readOnly && (
        <div className="visit-cap-foot">
          {err && !err.field?.startsWith('o') && <p className="err" role="alert" style={{ margin: 0 }}>{err.msg}</p>}
          <p className="small muted" style={{ margin: 0 }} aria-live="polite">{t('visit.capture.result', { n: filled.length })}</p>
          <div className="row visit-cap-actions">
            <button type="button" className="btn primary lg" onClick={() => void submit()} disabled={pending} data-loading={pending || undefined}>{t('visit.capture.complete')}</button>
            {next && <span className="small muted ellipsis">{t('visit.next', { label: next.label })}</span>}
          </div>
        </div>
      )}
      </>}
      {confirmDialog}
      {navDialog}
    </section>
  )
}

function GuardedNext({ href, label }: { href: string; label: string }) {
  const [go, dialog] = useGuardedNav()
  return <><button type="button" className="btn primary" onClick={() => void go(href)}>{label}</button>{dialog}</>
}
