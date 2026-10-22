'use client'

import { useOptimistic, useRef, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { isQueued, orQueue } from '@/lib/offline/client'
import { toggleTask } from '../day/actions'

export type BedsideTask = { id: string; time: string; title: string; category: string; tone: string; over: boolean; now: boolean; done: boolean; doneLabel: string | null }

/**
 * Jetzt fällige Massnahmen am Bett: grosse Fläche «Erledigt» (optimistisch, Rückgängig im Hinweis, offline vorgemerkt).
 * Teilweise / nicht durchgeführt mit Begründung im Tagesplan.
 */
export function BedsideTasks({ residentId, who, tasks, canComplete }: { residentId: string; who: string; tasks: BedsideTask[]; canComplete: boolean }) {
  const t = useT()
  const [, start] = useTransition()
  const [list, setDone] = useOptimistic(tasks, (cur: BedsideTask[], u: { id: string; done: boolean }) => cur.map((k) => (k.id === u.id ? { ...k, done: u.done, doneLabel: u.done ? t('chart.bedside.doneNow') : null } : k)))
  const inflight = useRef(new Set<string>())
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const set = (k: BedsideTask, done: boolean) => {
    if (inflight.current.has(k.id)) return
    inflight.current.add(k.id)
    start(async () => {
      setDone({ id: k.id, done })
      try {
        const r = done ? await orQueue(() => toggleTask(k.id, true), { kind: 'task', residentId, data: { taskId: k.id, status: 'done' } }, { who, label: k.title }) : await toggleTask(k.id, false)
        if (isQueued(r)) return void toast(t(r.message))
        if (!r.ok) return void toast(tr(r.error), { kind: 'crit', ms: 6000 })
        if (done) toast(t('chart.day.toastDone', { title: k.title }), { undoLabel: t('common.undo'), undo: () => set(k, false) })
      } finally {
        inflight.current.delete(k.id)
      }
    })
  }
  return (
    <ul className="bedside-tasks">
      {list.map((k) => (
        <li key={k.id} className={k.done ? 'is-done' : k.over ? 'is-over' : undefined}>
          <span className="mono bt-time">{k.time}</span>
          <div className="bt-main">
            <div className="bt-title">{k.title}</div>
            <div className="small">
              <span className={'tag ' + k.tone}>{k.category}</span>{' '}
              {k.done ? <span className="ok-text">✓ {k.doneLabel}</span> : k.over ? <span className="crit-text">▲ {t('chart.bedside.overdue')}</span> : null}
            </div>
          </div>
          {canComplete && (k.done
            ? <button type="button" className="btn" onClick={() => set(k, false)}>{t('chart.bedside.reopen')}</button>
            : <button type="button" className={'btn lg' + (k.over || k.now ? ' primary' : '')} onClick={() => set(k, true)} aria-label={`${t('chart.bedside.done')}: ${k.title}`}>✓ {t('chart.bedside.done')}</button>)}
        </li>
      ))}
      <li className="bt-more"><Link className="linkbtn small" href={`/residents/${residentId}/day`}>{t('chart.bedside.toDay')} →</Link></li>
    </ul>
  )
}
