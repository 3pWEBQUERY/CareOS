'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { analyzePatternsAction, aiFeedbackAction, toggleActionAction, type PatternFilter } from './actions'

/** Filterzeile: jede Änderung aktualisiert die URL (teilbar, Zurück-Taste funktioniert). */
export function AutoFilter({ children, className = 'row' }: { children: React.ReactNode; className?: string }) {
  const router = useRouter()
  const path = usePathname()
  const [pending, start] = useTransition()
  // Nativer Listener: erfasst auch Feld-Komponenten (Combobox), deren verstecktes Feld «change» auslöst
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const form = ref.current
    if (!form) return
    const onChange = () => {
      const q = new URLSearchParams()
      for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string' && v) q.set(k, v)
      start(() => router.replace(path + (q.size ? '?' + q.toString() : ''), { scroll: false }))
    }
    form.addEventListener('change', onChange)
    return () => form.removeEventListener('change', onChange)
  }, [router, path])
  return (
    <form
      ref={ref}
      className={className}
      method="get"
      data-pending={pending || undefined}
      style={pending ? { opacity: 0.7 } : undefined}
      onSubmit={(e) => e.preventDefault()}
    >
      {children}
    </form>
  )
}

/** Quality Assistant: anonymisierte Musteranalyse mit CareOS AI. Ergebnis wird nie gespeichert. */
export function PatternAssistant({ filter }: { filter: PatternFilter }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [res, setRes] = useState<{ id: string; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="stack-sm">
      <div className="row">
        <button
          type="button"
          className="btn"
          data-loading={pending || undefined}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr(null)
              const r = await analyzePatternsAction(filter)
              if (r.ok && r.data) setRes(r.data)
              else if (!r.ok) setErr(t(r.error))
            })
          }
        >
          {pending ? t('common.ai.generating') : t('quality.ai.analyze')}
        </button>
        <span className="small muted">{t('quality.ai.privacy')}</span>
      </div>
      {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      {res && (
        <div className="ai-box" role="region" aria-label={t('quality.ai.title')}>
          <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
          <div className="ai-text">{res.text}</div>
          <div className="row">
            <button type="button" className="btn sm" onClick={() => { void aiFeedbackAction(res.id, true); toast(t('quality.ai.thanks')) }}>{t('quality.ai.helpful')}</button>
            <button type="button" className="btn sm ghost" onClick={() => { void aiFeedbackAction(res.id, false); setRes(null) }}>{t('common.ai.discard')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Complete (PRD §49) für eine Ereignis-Massnahme – gleiche Bedienung wie bei Aufgaben: Häkchen «quittieren»,
 * Rückgängig im Hinweis; verknüpfte Aufgabe wird synchron gehalten.
 */
export function ActionCheck({ id, done, disabled, label }: { id: string; done: boolean; disabled?: boolean; label: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const toggle = (undo: boolean) =>
    start(async () => {
      const r = await toggleActionAction(id)
      if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
      if (undo) return
      if (!done) toast(t('tasks.toast.done', { title: label }), { undo: () => toggle(true), undoLabel: t('common.undo') })
      else toast(t('tasks.toast.reopened'))
    })
  return (
    <button
      type="button"
      className="chk"
      aria-pressed={done}
      aria-label={t(done ? 'tasks.actions.reopenFor' : 'tasks.actions.completeFor', { title: label })}
      title={t(done ? 'tasks.actions.reopen' : 'tasks.actions.complete')}
      disabled={disabled || pending}
      style={pending ? { opacity: 0.6 } : undefined}
      onClick={() => toggle(false)}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  )
}
