'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { IconMic, IconSpark } from '@/components/icons'
import { correctNote, createNote, discardDraft, draftNote, type NoteInput } from './actions'
import { isQueued, orQueue } from '@/lib/offline/client'
import { NoteAck, StructuredView, type NoteAckInfo } from '@/components/forms/StructuredView'
import type { StructuredForm } from '@/lib/forms'
import { AskQuestionDialog } from '@/components/visit/AskQuestion'
import { Checkbox, TextField, Textarea } from '@/components/ui/fields'

export type NoteRow = {
  id: string; at: string; rel: string; category: string; text: string; author: string; important: boolean; aiAssisted: boolean
  source: string; fromTask: boolean; supersedes: boolean; correctedBy: { by: string; at: string } | null; canCorrect: boolean
  /** Formulareintrag (Fokusdokumentation) und Kenntnisnahme wichtiger Einträge */
  structured?: StructuredForm | null; ack?: NoteAckInfo | null
  /** Offline erfasst und später synchronisiert (PRD §39) */
  offline?: boolean
  /** Optimistisch angezeigt, Speicherung läuft (PRD §31) */
  pending?: boolean
  /** Offene Frage für die Visite mit Bezug auf diesen Eintrag */
  visitAsked?: boolean
}
type Cat = { key: string; label: string; tone: string }

const SNIPS = ['s1', 's2', 's3', 's4', 's5', 's6']

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
  start(): void; stop(): void
}
const speechCtor = () => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function Notes({ residentId, who, me, notes, categories, canWrite, aiOn, formSlot }: {
  residentId: string; who: string; me: string; notes: NoteRow[]; categories: Cat[]; canWrite: boolean; aiOn: boolean
  /** Knopf "Formular" (Fokusdokumentation), vom Server gerendert */
  formSlot?: React.ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  const [filter, setFilter] = useState('all')
  const [fresh, setFresh] = useState<string | null>(null)
  const [category, setCategory] = useState(categories[0]?.key ?? 'care')
  const [text, setText] = useState('')
  const [important, setImportant] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [source, setSource] = useState<'manual' | 'voice' | 'ai'>('manual')
  const [aiId, setAiId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [optNotes, addPending] = useOptimistic(notes, (cur: NoteRow[], n: NoteRow) => [n, ...cur])
  // Offline vorgemerkt: bis zur Synchronisation mit Hinweis «Offline erfasst» im Verlauf (PRD §39)
  const [queuedNotes, setQueuedNotes] = useState<NoteRow[]>([])
  const [aiPending, startAi] = useTransition()
  const [listening, setListening] = useState(false)
  const [speechOk, setSpeechOk] = useState(false)
  const [correcting, setCorrecting] = useState<NoteRow | null>(null)
  // «Für Visite vormerken» an der Zeile (PRD §29): ein Dialog für alle Zeilen, Markierung sofort nach dem Speichern
  const [asking, setAsking] = useState<NoteRow | null>(null)
  const [askedNow, setAskedNow] = useState<string[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const rec = useRef<SpeechRec | null>(null)
  const tone = (k: string) => categories.find((c) => c.key === k)?.tone ?? ''
  const label = (k: string) => categories.find((c) => c.key === k)?.label ?? k

  useEffect(() => { setSpeechOk(!!speechCtor()) }, [])
  useEffect(() => () => rec.current?.stop(), [])

  const insertSnip = (s: string) => {
    const el = ta.current
    if (!el) return
    const p = el.selectionStart ?? text.length
    const pre = text.slice(0, p)
    const sep = pre && !/\s$/.test(pre) ? ' ' : ''
    const next = pre + sep + s + ' ' + text.slice(el.selectionEnd ?? p)
    setText(next)
    const c = (pre + sep + s + ' ').length
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(c, c) })
  }

  const toggleMic = () => {
    if (listening) { rec.current?.stop(); return }
    const Ctor = speechCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.lang = INTL_LOCALE[locale]
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      let add = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript
      if (add.trim()) {
        setText((cur) => (cur && !/\s$/.test(cur) ? cur + ' ' : cur) + add.trim())
        setSource((s) => (s === 'ai' ? s : 'voice'))
      }
    }
    r.onend = () => setListening(false)
    r.onerror = () => { setListening(false); toast(t('chart.notes.voiceError'), { kind: 'crit' }) }
    rec.current = r
    r.start()
    setListening(true)
  }

  const save = () => {
    const v = text.trim()
    if (v.length < 3) { setErr(t('chart.notes.errors.empty')); ta.current?.focus(); return }
    rec.current?.stop()
    const snap = { important, source, aiId }
    // Feld sofort leeren (dringendes Update ausserhalb der Transition), damit sofort weiter dokumentiert werden kann
    setErr(null); setText(''); setImportant(false); setSource('manual'); setAiId(null); setFilter('all')
    ta.current?.focus() // Absende-Knopf wird während des Speicherns deaktiviert – Fokus bleibt im Eingabefeld
    start(async () => {
      // Eintrag erscheint sofort im Verlauf (PRD §31); bei Fehler kommt der Text zurück ins Feld
      const at = new Date()
      const row: NoteRow = {
        id: 'pending-' + at.getTime(), at: at.toISOString(), rel: t('common.today') + ' ' + hm(at), category, text: v, author: me, important: snap.important,
        aiAssisted: snap.source === 'ai', source: snap.source, fromTask: false, supersedes: false, correctedBy: null, canCorrect: false, pending: true,
      }
      addPending(row)
      const restore = (msg: string) => {
        setText((cur) => (cur.trim() ? cur : v)); setImportant(snap.important); setSource(snap.source); setAiId(snap.aiId); setErr(msg)
      }
      try {
        // Ohne Verbindung: verschlüsselt vormerken und später synchronisieren (PRD §39)
        const r = await orQueue(() => createNote(residentId, { category: category as NoteInput['category'], text: v, important: snap.important, source: snap.source, aiId: snap.aiId }), { kind: 'note', residentId, data: { category, text: v, important: snap.important } }, { who })
        if (isQueued(r)) { setQueuedNotes((c) => [{ ...row, id: 'queued-' + at.getTime(), pending: false, offline: true }, ...c]); setDraft(null); toast(t(r.message)); return }
        if (!r.ok) return restore(t(r.error))
        setDraft(null)
        setFresh(r.data?.id ?? null)
        toast(t('chart.notes.saved', { at: t('common.today') + ' ' + hm(at) }))
      } catch {
        restore(t('common.genericError'))
      }
    })
  }

  const askAi = () => {
    if (text.trim().length < 3) { setErr(t('chart.notes.errors.aiEmpty')); ta.current?.focus(); return }
    setErr(null)
    startAi(async () => {
      const r = await draftNote(residentId, { text, category })
      if (!r.ok) { setErr(t(r.error)); return }
      setDraft(r.data ?? null)
    })
  }
  const acceptDraft = () => {
    if (!draft) return
    setText(draft.text); setAiId(draft.id); setSource('ai'); setDraft(null)
    requestAnimationFrame(() => ta.current?.focus())
  }
  const rejectDraft = () => {
    if (!draft) return
    void discardDraft(draft.id)
    setDraft(null)
  }

  // Vormerkbar: gespeicherte, nicht korrigierte Einträge ohne offene Frage (gleiche Berechtigung wie in der Übersicht)
  const askable = (n: NoteRow) => canWrite && !n.pending && !n.correctedBy && !n.id.startsWith('queued-') && !n.visitAsked && !askedNow.includes(n.id)
  const synced = (q: NoteRow) => notes.some((n) => n.text === q.text && n.category === q.category)
  const list = [...queuedNotes.filter((q) => !synced(q)), ...optNotes].filter((n) => filter === 'all' || n.category === filter || (filter === 'important' && n.important))

  return (
    <>
      {canWrite && (
        <form className="entry" noValidate onSubmit={(e) => { e.preventDefault(); save() }} aria-busy={pending}>
          <div className="entry-head">
            <label className="lbl" htmlFor="ncat">{t('chart.notes.category')}</label>
            <select id="ncat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <span className="lbl" style={{ marginLeft: 6 }} id="nsnips">{t('chart.notes.snippets')}</span>
            <span className="snips" role="group" aria-labelledby="nsnips">
              {SNIPS.map((s) => {
                const txt = t('chart.notes.snip.' + s)
                return <button key={s} type="button" className="snip" onClick={() => insertSnip(txt)}>{txt.replace(/[.]$/, '')}</button>
              })}
            </span>
          </div>
          <textarea
            id="ntext" ref={ta} value={text} aria-label={t('chart.notes.entryLabel')} aria-invalid={err ? true : undefined} aria-describedby={err ? 'ntext-err' : undefined} placeholder={t('chart.notes.placeholder')}
            onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save() } }}
          />
          {draft && (
            <div className="ai-box" style={{ margin: '0 10px 10px' }}>
              <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
              <div className="ai-text">{draft.text}</div>
              <div className="row">
                <button type="button" className="btn sm primary" onClick={acceptDraft}>{t('common.ai.accept')}</button>
                <button type="button" className="btn sm" onClick={rejectDraft}>{t('common.ai.discard')}</button>
              </div>
            </div>
          )}
          <div className="entry-foot">
            <span className="small muted">{me} · {t('chart.notes.ctrlEnter')}</span>
            <Checkbox checked={important} onChange={(e) => setImportant(e.target.checked)} label={t('chart.notes.important')} wrapClassName="small" />
            {source === 'voice' && <span className="tag outline">{t('chart.notes.voiceDraft')}</span>}
            {source === 'ai' && <span className="tag violet">{t('chart.notes.aiAssisted')}</span>}
            {err && <span className="err" id="ntext-err" role="alert">{err}</span>}
            <span className="push">
              {formSlot}
              {speechOk && (
                <button type="button" className="btn" onClick={toggleMic} aria-pressed={listening} title={t('chart.notes.voiceHint')}
                  style={listening ? { borderColor: 'var(--crit)', color: 'var(--crit)' } : undefined}>
                  <IconMic size={16} />{listening ? t('chart.notes.voiceStop') : t('chart.notes.voice')}
                </button>
              )}
              {aiOn && (
                <button type="button" className="btn" onClick={askAi} data-loading={aiPending || undefined} disabled={aiPending}>
                  <IconSpark size={16} />{aiPending ? t('common.ai.generating') : t('chart.notes.aiDraft')}
                </button>
              )}
              <button className="btn primary" type="submit" data-loading={pending || undefined} disabled={pending}>{t('chart.notes.save')}</button>
            </span>
          </div>
        </form>
      )}

      <div className="sec-head">
        <h2 className="sec">{t('chart.notes.title')}</h2>
        <div className="chips notes-filter" role="group" aria-label={t('common.filter')}>
          {[{ key: 'all', label: t('common.all') }, ...categories, { key: 'important', label: t('chart.notes.importantFilter') }].map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>{c.label}</button>
          ))}
        </div>
      </div>
      {list.length ? (
        <ol className="notes">
          {list.map((n) => (
            <li key={n.id} className={'note' + (fresh === n.id ? ' fresh' : '') + (n.correctedBy ? ' superseded' : '') + (n.pending ? ' is-pending' : '')} aria-busy={n.pending || undefined}>
              <time className="mono" dateTime={n.at}>{n.rel}</time>
              <div style={{ minWidth: 0 }}>
                <div className="nh">
                  <span className={'tag ' + tone(n.category)}>{label(n.category)}</span>
                  {n.important && <span className="tag crit">{t('chart.notes.importantTag')}</span>}
                  {n.supersedes && <span className="tag outline">{t('chart.notes.correction')}</span>}
                  {n.aiAssisted && <span className="tag violet">{t('chart.notes.aiAssisted')}</span>}
                  {n.source === 'voice' && <span className="tag outline">{t('chart.notes.voiceTag')}</span>}
                  {n.fromTask && <span className="tag outline">{t('chart.notes.fromTask')}</span>}
                  {n.offline && <span className="tag outline">{t('common.offlineSync.tag')}</span>}
                  {(n.visitAsked || askedNow.includes(n.id)) && <span className="tag accent">{t('visit.ask.marked')}</span>}
                  {n.pending && <span className="small muted">{t('common.saving')}</span>}
                  <span className="au">{n.author}</span>
                  {(n.canCorrect || askable(n)) && (
                    <span className="row" style={{ marginLeft: 'auto', gap: 12 }}>
                      {askable(n) && <button type="button" className="linkbtn small" onClick={() => setAsking(n)}>{t('visit.ask.rowAction')}</button>}
                      {n.canCorrect && <button type="button" className="linkbtn small" onClick={() => setCorrecting(n)}>{t('chart.notes.correct')}</button>}
                    </span>
                  )}
                </div>
                {n.structured ? <StructuredView s={n.structured} /> : <p>{n.text}</p>}
                {n.ack && <NoteAck residentId={residentId} id={n.id} ack={n.ack} />}
                {n.correctedBy && <div className="small muted" style={{ marginTop: 4 }}>{t('chart.notes.correctedBy', { by: n.correctedBy.by, at: n.correctedBy.at })}</div>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t(notes.length ? 'chart.notes.noneInCat' : 'chart.notes.none')}</p>
      )}

      <Correct residentId={residentId} who={who} note={correcting} onClose={() => setCorrecting(null)} onDone={(id) => { setFresh(id); setFilter('all') }} />
      {canWrite && (
        <AskQuestionDialog
          open={!!asking}
          onClose={() => setAsking(null)}
          residentId={residentId}
          who={who}
          options={[]}
          initialRef={asking ? 'observation:' + asking.id : ''}
          refOption={asking ? { value: 'observation:' + asking.id, group: 'observation', label: `${label(asking.category)} · ${asking.rel} · ${asking.text.length > 70 ? asking.text.slice(0, 69).trimEnd() + '…' : asking.text}` } : undefined}
          onAsked={(ref) => { const id = ref.split(':')[1]; if (id) setAskedNow((c) => [...c, id]) }}
        />
      )}
    </>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const hm = (d: Date) => pad(d.getHours()) + ':' + pad(d.getMinutes())

function Correct({ residentId, who, note, onClose, onDone }: { residentId: string; who: string; note: NoteRow | null; onClose: () => void; onDone: (id: string) => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [pending, start] = useTransition()
  if (note && key !== note.id) { setKey(note.id); setText(note.text); setReason(''); setErr(null) }
  const submit = () => {
    if (!note) return
    start(async () => {
      const r = await correctNote(residentId, note.id, { text, reason })
      if (!r.ok) return setErr(t(r.error))
      toast(t('chart.notes.corrected'))
      if (r.data) onDone(r.data.id)
      onClose()
    })
  }
  return (
    <Dialog open={!!note} onClose={onClose} title={t('chart.notes.correctTitle')} context={<span>{who}</span>}
      footer={<><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button type="button" className="btn primary" onClick={submit} data-loading={pending || undefined} disabled={pending}>{t('chart.notes.correctSave')}</button></>}>
      {note && (
        <>
          <p className="small muted" style={{ margin: 0 }}>{t('chart.notes.correctHint')}</p>
          <div className="note superseded" style={{ padding: 0 }}><time className="mono">{note.rel}</time><p>{note.text}</p></div>
          <Textarea label={t('chart.notes.correctText')} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          <TextField label={t('chart.notes.correctReason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('chart.notes.correctReasonPh')} />
          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
        </>
      )}
    </Dialog>
  )
}
