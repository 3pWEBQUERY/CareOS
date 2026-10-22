'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { openFocusForm } from './FormEntry'

export type FocusSuggestionDto = {
  id: string
  rule: 'pain' | 'fall' | 'vitalAbnormal' | 'taskSkipped'
  at: string
  formKey: string | null
  formName: string | null
  prefill: Record<string, string>
  vars: Record<string, string | number>
}

/** Text eines Verlaufseintrags vorbelegen (Notes hört darauf). */
export const FOCUS_NOTE_EVENT = 'careos:focus-note'
export function openFocusNote(category: string, text: string) {
  window.dispatchEvent(new CustomEvent(FOCUS_NOTE_EVENT, { detail: { category, text } }))
}

const KEY = 'careos_focus_dismissed'
const readDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] }
}

/**
 * Vorschläge zur Fokusdokumentation (PRD §10.3): erscheinen bei relevanten Veränderungen (Schmerz, Sturz,
 * auffällige Messung, wiederholt nicht durchgeführte Massnahme), bis dokumentiert wurde oder das Zeitfenster
 * abläuft. «Nicht nötig» blendet den Vorschlag nur auf diesem Gerät aus.
 * `notesHref`: ausserhalb des Verlaufs führen Vorschläge ohne Formular dorthin.
 */
export function FocusSuggestions({ items, notesHref }: { items: FocusSuggestionDto[]; notesHref?: string }) {
  const t = useT()
  const locale = useLocale()
  const [dismissed, setDismissed] = useState<string[] | null>(null)
  useEffect(() => setDismissed(readDismissed()), [])
  if (dismissed == null) return null
  const list = items.filter((s) => !dismissed.includes(s.id))
  if (!list.length) return null
  const time = (iso: string) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-100)
    setDismissed(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* privat/blockiert: nur für diese Ansicht */ }
  }
  const act = (s: FocusSuggestionDto) => {
    if (s.formKey) return openFocusForm(s.formKey, s.prefill)
    const category = s.rule === 'taskSkipped' ? 'care' : 'observation'
    openFocusNote(category, t('chart.focus.noteStart.' + s.rule, { ...s.vars, time: time(s.at) }))
  }
  return (
    <section className="focus-sugg stack-sm" aria-label={t('chart.focus.label')}>
      {list.map((s) => (
        <div key={s.id} className="alert info">
          <div className="grow">
            <strong>{s.formName ? t('chart.focus.titleForm', { form: s.formName }) : t('chart.focus.titleNote')}</strong>
            <span className="fg">{t('chart.focus.why.' + s.rule, { ...s.vars, time: time(s.at) })}</span>
          </div>
          <div className="row focus-act">
            {s.formKey || !notesHref
              ? <button type="button" className="btn sm primary" onClick={() => act(s)}>{t('chart.focus.document')}</button>
              : <Link className="btn sm primary" href={notesHref}>{t('chart.focus.toNotes')}</Link>}
            <button type="button" className="btn sm ghost" onClick={() => dismiss(s.id)}>{t('chart.focus.dismiss')}</button>
          </div>
        </div>
      ))}
    </section>
  )
}
