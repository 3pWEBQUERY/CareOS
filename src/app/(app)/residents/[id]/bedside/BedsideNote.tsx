'use client'

import { useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { SegmentedControl, Textarea } from '@/components/ui/fields'
import { isQueued, orQueue } from '@/lib/offline/client'
import { createNote, type NoteInput } from '../notes/actions'

const SNIPS = ['s1', 's2', 's3', 's4', 's5', 's6']

/** Kurzer Verlaufseintrag am Bett (PRD §29): grosse Textbausteine, Kategorie Pflege/Beobachtung, ohne Verbindung vorgemerkt. */
export function BedsideNote({ residentId, who }: { residentId: string; who: string }) {
  const t = useT()
  const [text, setText] = useState('')
  const [category, setCategory] = useState<'care' | 'observation'>('care')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const ta = useRef<HTMLTextAreaElement>(null)
  const save = () => {
    const v = text.trim()
    if (v.length < 3) { setErr(t('chart.notes.errors.empty')); ta.current?.focus(); return }
    setErr(null)
    start(async () => {
      const r = await orQueue(() => createNote(residentId, { category: category as NoteInput['category'], text: v, important: false, source: 'manual' }), { kind: 'note', residentId, data: { category, text: v, important: false } }, { who })
      if (isQueued(r)) { setText(''); return void toast(t(r.message)) }
      if (!r.ok) return setErr(/^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error)
      setText('')
      toast(t('chart.bedside.noteSaved'))
    })
  }
  return (
    <form className="stack-sm" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
      <SegmentedControl aria-label={t('chart.notes.category')} value={category} onChange={(v) => setCategory(v as 'care' | 'observation')}
        options={[{ value: 'care', label: t('chart.cat.care') }, { value: 'observation', label: t('chart.cat.observation') }]} />
      <div className="bedside-snips" role="group" aria-label={t('chart.notes.snippets')}>
        {SNIPS.map((s) => {
          const txt = t('chart.notes.snip.' + s)
          return <button key={s} type="button" className="btn" onClick={() => setText((c) => (c.trim() ? c.trimEnd() + ' ' : '') + txt + ' ')}>{txt.replace(/[.]$/, '')}</button>
        })}
      </div>
      <Textarea ref={ta} label={t('chart.notes.entryLabel')} hideLabel rows={4} value={text} onChange={(e) => { setText(e.target.value); setErr(null) }} placeholder={t('chart.notes.placeholder')} error={err ?? undefined} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn primary lg" disabled={pending} data-loading={pending || undefined}>{t('chart.notes.save')}</button>
      </div>
    </form>
  )
}
