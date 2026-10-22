'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { scoreAssessment, type AssessmentDef } from '@/lib/clinical-config'
import { correctAssessmentAction, saveAssessmentAction } from './actions'
import { CorrectionDialog } from '@/components/residents/CorrectionDialog'
import { RadioGroup } from '@/components/ui/fields'

/** Assessment durchführen: Fragen als grosse Auswahlflächen, Punktwert live (CareOS Assess). */
export function PerformAssessment({ residentId, def, name, contextLabel, nextDueLabel, planHref }: {
  residentId: string
  def: AssessmentDef
  name: string
  contextLabel: string
  nextDueLabel: string | null
  planHref: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [doneLevel, setDoneLevel] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const qs = def.items.questions
  const answered = qs.filter((q) => answers[q.key] != null).length
  const complete = answered === qs.length
  const live = useMemo(() => scoreAssessment(def, answers), [def, answers])

  const save = () => {
    setTried(true)
    if (!complete) return setErr(t('care.assessments.incomplete'))
    start(async () => {
      const r = await saveAssessmentAction(residentId, def.key, answers)
      if (!r.ok) return setErr(/^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error)
      toast(t('care.assessments.saved'))
      if (r.data?.level === 'crit') setDoneLevel('crit')
      else setOpen(false)
    })
  }

  return (
    <>
      <button type="button" className="btn sm" onClick={() => { setAnswers({}); setErr(null); setTried(false); setDoneLevel(null); setOpen(true) }}>{t('care.assessments.perform')}</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={t('care.assessments.formTitle', { name })}
        context={contextLabel}
        footer={doneLevel ? (
          <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.close')}</button>
        ) : (
          <>
            <span className="row" style={{ marginRight: 'auto', gap: 8 }} aria-live="polite">
              <span className="lbl">{t('care.assessments.liveScore')}</span>
              <span className="mono" style={{ fontSize: '1.0625rem', fontWeight: 500 }}>{live.score}</span>
              {complete ? <span className={'tag ' + live.level}>{live.result}</span> : <span className="small muted">{t('care.assessments.answered', { n: answered, total: qs.length })}</span>}
            </span>
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn primary" disabled={pending} data-loading={pending || undefined} onClick={save}>{t('care.assessments.save')}</button>
          </>
        )}
      >
        {doneLevel ? (
          <div className="alert crit" role="alert">
            <div className="grow">
              <strong>{live.score} · {live.result}</strong>
              <span className="fg">{t('care.assessments.critHint')}</span>
            </div>
            <Link className="btn sm" href={planHref} onClick={() => setOpen(false)}>{t('care.assessments.toPlan')}</Link>
          </div>
        ) : (
          <>
            {def.description && <p className="small muted" style={{ margin: 0 }}>{def.description}</p>}
            <div className="stack-sm">
              {qs.map((q) => {
                const missing = tried && answers[q.key] == null
                return (
                  <fieldset key={q.key} className="care-q" data-missing={missing || undefined} style={{ border: 0, padding: 0 }}>
                    <legend className="lbl">{q.label}{missing ? ' · ' + t('common.required') : ''}</legend>
                    <RadioGroup
                      name={q.key} aria-label={q.label} variant="card" className={'care-opts' + (q.options.length > 6 ? ' nrs' : '')}
                      aria-invalid={missing || undefined}
                      value={answers[q.key] != null ? String(answers[q.key]) : ''}
                      onChange={(v) => { setAnswers({ ...answers, [q.key]: Number(v) }); setErr(null) }}
                      options={q.options.map((o) => ({ value: String(o.v), label: <span className="rg-row"><span>{o.label}</span>{q.options.length <= 6 && <span className="pts">{o.v}</span>}</span> }))}
                    />
                  </fieldset>
                )
              })}
            </div>
            {nextDueLabel && <p className="small muted" style={{ margin: 0 }}>{nextDueLabel}</p>}
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          </>
        )}
      </Dialog>
    </>
  )
}

/** «Korrigieren» in der Assessment-Historie: Antworten vorbelegt, Punktwert neu berechnet, Begründung Pflicht (PRD §35). */
export function CorrectAssessment({ residentId, assessmentId, def, name, who, when, answers, summary }: {
  residentId: string
  assessmentId: string
  def: AssessmentDef
  name: string
  who: string
  when: string
  answers: Record<string, number>
  summary: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState<Record<string, number>>(answers)
  const live = useMemo(() => scoreAssessment(def, cur), [def, cur])
  const complete = def.items.questions.every((q) => cur[q.key] != null)
  return (
    <>
      <button type="button" className="linkbtn small" onClick={() => { setCur(answers); setOpen(true) }} aria-label={`${t('chart.void.action')}: ${name} ${when}`}>{t('chart.void.action')}</button>
      {open && (
        <CorrectionDialog
          open
          onClose={() => setOpen(false)}
          title={t('chart.void.titleAssessment')}
          who={who}
          original={<><strong>{name}</strong> · <span className="mono">{when}</span> · {summary}</>}
          action={(f) => correctAssessmentAction(residentId, assessmentId, f)}
          fields={
            <div className="stack-sm">
              {def.items.questions.map((q) => (
                <RadioGroup
                  key={q.key} name={'q_' + q.key} label={q.label} inline
                  value={cur[q.key] != null ? String(cur[q.key]) : ''}
                  onChange={(v) => setCur((c) => ({ ...c, [q.key]: Number(v) }))}
                  options={q.options.map((o) => ({ value: String(o.v), label: q.options.length <= 6 ? `${o.label} (${o.v})` : o.label }))}
                />
              ))}
              <p className="row" style={{ gap: 8, margin: 0 }} aria-live="polite">
                <span className="lbl">{t('care.assessments.liveScore')}</span>
                <span className="mono">{live.score}</span>
                {complete && <span className={'tag ' + live.level}>{live.result}</span>}
              </p>
            </div>
          }
        />
      )}
    </>
  )
}
