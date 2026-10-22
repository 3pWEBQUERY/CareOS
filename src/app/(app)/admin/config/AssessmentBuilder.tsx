'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { NumberField, Select, TextField, Textarea } from '@/components/ui/fields'
import { LEVELS, rangeProblem, scoreBounds } from '@/lib/assessment-builder'
import { saveAssessmentDefinitionAction } from './assessment-actions'

type Opt = { label: string; v: number | '' }
type Q = { label: string; options: Opt[] }
type R = { min: number | ''; max: number | ''; result: string; level: (typeof LEVELS)[number] }
export type BuilderValue = { id?: string; name: string; description: string; intervalDays: number | null; questions: { label: string; options: { label: string; v: number }[] }[]; ranges: { min: number; max: number; result: string; level: 'ok' | 'warn' | 'crit' }[] }

const EMPTY_Q = (): Q => ({ label: '', options: [{ label: '', v: 0 }, { label: '', v: 1 }] })
const num = (v: number | '') => (v === '' ? NaN : v)

/** Eigenes Assessment-Instrument (PRD §45): Fragen mit Antworten und Punkten, Bewertung über Punktbereiche. */
export function AssessmentBuilderButton({ initial, label, buttonClass = 'btn sm' }: { initial?: BuilderValue; label: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{label}</button>
      {open && <Builder initial={initial} onClose={() => setOpen(false)} />}
    </>
  )
}

function Builder({ initial, onClose }: { initial?: BuilderValue; onClose: () => void }) {
  const t = useT()
  const [qs, setQs] = useState<Q[]>(initial?.questions ?? [EMPTY_Q()])
  const [rs, setRs] = useState<R[]>(initial?.ranges ?? [{ min: 0, max: 0, result: '', level: 'ok' }])
  const [name, setName] = useState(initial?.name ?? '')
  const [desc, setDesc] = useState(initial?.description ?? '')
  const [interval, setIntervalDays] = useState<number | ''>(initial?.intervalDays ?? '')

  const setQ = (i: number, patch: Partial<Q>) => setQs((s) => s.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const setO = (i: number, k: number, patch: Partial<Opt>) => setQ(i, { options: qs[i].options.map((o, j) => (j === k ? { ...o, ...patch } : o)) })
  const moveQ = (i: number, d: -1 | 1) => setQs((s) => {
    const n = [...s]
    const j = i + d
    if (j < 0 || j >= n.length) return s
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })
  const setR = (i: number, patch: Partial<R>) => setRs((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const numeric = qs.map((q) => ({ options: q.options.filter((o) => o.v !== '').map((o) => ({ v: o.v as number })) }))
  const bounds = scoreBounds(numeric)
  const rangesOk = rs.every((r) => r.min !== '' && r.max !== '')
  const problem = rangesOk && rs.length ? rangeProblem(numeric, rs.map((r) => ({ min: num(r.min), max: num(r.max) }))) : null
  const payload = JSON.stringify({ name, description: desc, intervalDays: interval, questions: qs, ranges: rs })

  return (
    <Dialog open onClose={onClose} title={t(initial ? 'forms.assessment.editTitle' : 'forms.assessment.createTitle')} wide>
      <ActionForm action={saveAssessmentDefinitionAction} onDone={(r) => r.ok && onClose()}>
        {initial?.id && <input type="hidden" name="id" value={initial.id} />}
        <input type="hidden" name="def" value={payload} />
        <div className="form-grid">
          <TextField label={t('forms.assessment.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder={t('forms.assessment.namePh')} />
          <NumberField label={t('admin.config.intervalDays')} value={interval} onChange={setIntervalDays} min={1} max={730} step={1} unit={t('tasks.recur.unit.daily')} optional hint={t('forms.assessment.intervalHint')} />
          <Textarea label={t('forms.assessment.description')} optional wrapClassName="span-all" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
        </div>

        <section className="stack-sm" aria-labelledby="ab-q">
          <div className="sec-head">
            <h3 className="sec" id="ab-q">{t('forms.assessment.questions')}</h3>
            <span className="small muted">{t('forms.assessment.questionsHint')}</span>
          </div>
          <ol className="ab-list">
            {qs.map((q, i) => (
              <li key={i} className="card ab-q">
                <div className="card-body stack-sm">
                  <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
                    <TextField label={t('forms.assessment.question', { n: i + 1 })} wrapClassName="grow" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} required maxLength={200} />
                    <div className="row nowrap" style={{ gap: 2 }}>
                      <button type="button" className="btn sm ghost" onClick={() => moveQ(i, -1)} disabled={i === 0} aria-label={t('forms.assessment.up', { n: i + 1 })}>▲</button>
                      <button type="button" className="btn sm ghost" onClick={() => moveQ(i, 1)} disabled={i === qs.length - 1} aria-label={t('forms.assessment.down', { n: i + 1 })}>▼</button>
                      <button type="button" className="btn sm ghost" onClick={() => setQs((s) => s.filter((_, j) => j !== i))} disabled={qs.length < 2} aria-label={t('forms.assessment.removeQuestion', { n: i + 1 })}>✕</button>
                    </div>
                  </div>
                  <div className="tablewrap">
                    <table className="stable ab-opts">
                      <thead><tr><th>{t('forms.assessment.answer')}</th><th className="right">{t('forms.assessment.points')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
                      <tbody>
                        {q.options.map((o, k) => (
                          <tr key={k}>
                            <td><TextField value={o.label} onChange={(e) => setO(i, k, { label: e.target.value })} aria-label={t('forms.assessment.answerN', { q: i + 1, n: k + 1 })} required maxLength={120} /></td>
                            <td style={{ width: 110 }}><NumberField value={o.v} onChange={(v) => setO(i, k, { v })} step={1} min={-100} max={100} aria-label={t('forms.assessment.pointsN', { q: i + 1, n: k + 1 })} required /></td>
                            <td className="right" style={{ width: 48 }}>
                              <button type="button" className="btn sm ghost" onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })} disabled={q.options.length < 3} aria-label={t('forms.assessment.removeAnswer', { q: i + 1, n: k + 1 })}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div><button type="button" className="btn sm" onClick={() => setQ(i, { options: [...q.options, { label: '', v: q.options.length ? Math.max(...q.options.map((o) => (o.v === '' ? 0 : o.v))) + 1 : 0 }] })} disabled={q.options.length >= 12}>{t('forms.assessment.addAnswer')}</button></div>
                </div>
              </li>
            ))}
          </ol>
          <div><button type="button" className="btn sm" onClick={() => setQs((s) => [...s, EMPTY_Q()])} disabled={qs.length >= 40}>{t('forms.assessment.addQuestion')}</button></div>
        </section>

        <section className="stack-sm" aria-labelledby="ab-r">
          <div className="sec-head">
            <h3 className="sec" id="ab-r">{t('forms.assessment.ranges')}</h3>
            <span className="small muted mono">{t('forms.assessment.bounds', { min: bounds.min, max: bounds.max })}</span>
          </div>
          <div className="tablewrap">
            <table className="stable ab-ranges">
              <thead><tr><th>{t('forms.assessment.from')}</th><th>{t('forms.assessment.to')}</th><th>{t('admin.config.result')}</th><th>{t('forms.assessment.level')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
              <tbody>
                {rs.map((r, i) => (
                  <tr key={i}>
                    <td style={{ width: 100 }}><NumberField value={r.min} onChange={(v) => setR(i, { min: v })} step={1} aria-label={t('forms.assessment.fromN', { n: i + 1 })} required /></td>
                    <td style={{ width: 100 }}><NumberField value={r.max} onChange={(v) => setR(i, { max: v })} step={1} aria-label={t('forms.assessment.toN', { n: i + 1 })} required /></td>
                    <td><TextField value={r.result} onChange={(e) => setR(i, { result: e.target.value })} aria-label={t('forms.assessment.resultN', { n: i + 1 })} required maxLength={80} placeholder={t('forms.assessment.resultPh')} /></td>
                    <td style={{ width: 170 }}>
                      <Select value={r.level} onChange={(e) => setR(i, { level: e.target.value as R['level'] })} aria-label={t('forms.assessment.levelN', { n: i + 1 })}>
                        {LEVELS.map((l) => <option key={l} value={l}>{t('forms.assessment.levels.' + l)}</option>)}
                      </Select>
                    </td>
                    <td className="right" style={{ width: 48 }}>
                      <button type="button" className="btn sm ghost" onClick={() => setRs((s) => s.filter((_, j) => j !== i))} disabled={rs.length < 2} aria-label={t('forms.assessment.removeRange', { n: i + 1 })}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-between">
            <button type="button" className="btn sm" disabled={rs.length >= 10} onClick={() => setRs((s) => {
              const last = s[s.length - 1]
              const from = last && last.max !== '' ? last.max + 1 : bounds.min
              return [...s, { min: from, max: Math.max(from, bounds.max), result: '', level: 'warn' }]
            })}>{t('forms.assessment.addRange')}</button>
            {problem && <span className="small warn-text" role="status">{t(problem, { min: bounds.min, max: bounds.max })}</span>}
          </div>
        </section>

        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <Submit>{t(initial ? 'common.save' : 'common.create')}</Submit>
        </div>
      </ActionForm>
    </Dialog>
  )
}
