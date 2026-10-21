'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'

type Step = { key: string; title: string; category: string; offsetMin: number; durationMin: number }

/** Editor für den Folgeprozess eines Ereignistyps. Wird als JSON im Feld "workflow" übermittelt. */
export function WorkflowEditor({ initial }: { initial: Step[] }) {
  const t = useT()
  const [steps, setSteps] = useState<Step[]>(initial)
  const set = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) => setSteps((s) => {
    const n = [...s]
    const j = i + d
    if (j < 0 || j >= n.length) return s
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })
  return (
    <div className="stack-sm">
      <input type="hidden" name="workflow" value={JSON.stringify(steps)} />
      <span className="lbl">{t('admin.config.workflow')}</span>
      {steps.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead>
              <tr><th>#</th><th>{t('admin.config.stepTitleLabel')}</th><th>{t('admin.config.stepCategory')}</th><th>{t('admin.config.offsetMin')}</th><th>{t('admin.config.durationMin')}</th><th>{t('admin.config.stepKey')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i}>
                  <td className="num">{i + 1}</td>
                  <td><input className="field" value={s.title} onChange={(e) => set(i, { title: e.target.value })} aria-label={t('admin.config.stepTitleLabel')} style={{ minWidth: 180 }} required /></td>
                  <td><input className="field" value={s.category} onChange={(e) => set(i, { category: e.target.value })} aria-label={t('admin.config.stepCategory')} style={{ minWidth: 120 }} /></td>
                  <td><input className="field mono" type="number" min={0} value={s.offsetMin} onChange={(e) => set(i, { offsetMin: Number(e.target.value) })} aria-label={t('admin.config.offsetMin')} style={{ width: 90 }} /></td>
                  <td><input className="field mono" type="number" min={1} value={s.durationMin} onChange={(e) => set(i, { durationMin: Number(e.target.value) })} aria-label={t('admin.config.durationMin')} style={{ width: 80 }} /></td>
                  <td><input className="field mono" value={s.key} onChange={(e) => set(i, { key: e.target.value })} aria-label={t('admin.config.stepKey')} placeholder={t('admin.config.auto')} style={{ width: 110 }} /></td>
                  <td className="nowrap">
                    <button type="button" className="btn sm ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('admin.config.up')}>▲</button>
                    <button type="button" className="btn sm ghost" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={t('admin.config.down')}>▼</button>
                    <button type="button" className="btn sm ghost" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} aria-label={t('admin.common.remove')}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <span className="small muted">{t('admin.config.noSteps')}</span>}
      <div><button type="button" className="btn sm" onClick={() => setSteps((s) => [...s, { key: '', title: '', category: '', offsetMin: 60, durationMin: 10 }])}>{t('admin.config.addStep')}</button></div>
      <span className="small muted">{t('admin.config.workflowHint')}</span>
    </div>
  )
}
