'use client'

import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT, useLocale } from '@/i18n/client'
import { toast } from '@/components/toast'
import { IconFile, IconUpload } from '@/components/icons'
import { INTL_LOCALE } from '@/i18n/core'
import { REACTIONS } from './reactions'
import { addMemberAction, deleteMessageAction, editMessageAction, leaveConversationAction, markReadAction, muteAction, reactAction, sendMessageAction } from './actions'

export type ChatMsg = {
  id: string
  authorId: string
  author: string
  initials: string
  body: string
  at: string
  time: string
  edited: boolean
  deleted: boolean
  mine: boolean
  files: { id: string; name: string }[]
  reactions: { symbol: string; n: number; mine: boolean }[]
}
type Member = { id: string; name: string; initials: string; job: string }
type Conv = { id: string; kind: string; title: string; clinical: boolean; muted: boolean; lastMessageAt: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Pending = { tid: string; body: string; mentions: string; files: File[]; state: 'sending' | 'failed' | 'sent'; error?: string; at: number }

export function ChatView({ conv, me, members, candidates, messages, wasUnread, lastReadAt }: {
  conv: Conv
  me: string
  members: Member[]
  candidates: { id: string; name: string; hint: string }[]
  messages: ChatMsg[]
  wasUnread: boolean
  /** Lesestand beim Öffnen – bestimmt die Trennlinie «Neue Nachrichten». */
  lastReadAt: string
}) {
  const t = useT()
  const locale = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [showMembers, setShowMembers] = useState(false)
  const self = members.find((m) => m.id === me)
  const [, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn()
      if (!r.ok && r.error) toast(tr(r.error), { kind: 'crit' })
      else if (r.message) toast(tr(r.message))
    })

  // Als gelesen markieren beim Öffnen und bei neuen Nachrichten.
  useEffect(() => {
    if (wasUnread) void markReadAction(conv.id)
  }, [conv.id, conv.lastMessageAt, wasUnread])

  // Trennlinie «Neue Nachrichten»: Lesestand beim Öffnen festhalten (markRead ändert ihn danach).
  const [readMark] = useState(() => (wasUnread ? new Date(lastReadAt).getTime() : Infinity))
  const firstUnread = messages.find((m) => !m.mine && new Date(m.at).getTime() > readMark)?.id

  // Optimistisches Senden (PRD §31): Nachricht erscheint sofort, Fehler mit «Erneut senden».
  const [outbox, setOutbox] = useState<Pending[]>([])
  const [, startSend] = useTransition()
  // FormData überträgt Zeilenumbrüche als CRLF – für den Abgleich normalisieren.
  const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim()
  const delivered = (p: Pending) =>
    p.state === 'sent' && messages.some((m) => m.mine && norm(m.body) === norm(p.body) && new Date(m.at).getTime() >= p.at - 30000)
  const shownOutbox = outbox.filter((p) => !delivered(p))
  useEffect(() => {
    setOutbox((cur) => (cur.some(delivered) ? cur.filter((p) => !delivered(p)) : cur))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])
  const deliver = (p: Pending) => {
    setOutbox((cur) => [...cur.filter((x) => x.tid !== p.tid), { ...p, state: 'sending', error: undefined }])
    startSend(async () => {
      const f = new FormData()
      f.set('body', p.body)
      f.set('mentions', p.mentions)
      for (const x of p.files) f.append('files', x)
      let r: { ok: boolean; error?: string }
      try {
        r = await sendMessageAction(conv.id, f)
      } catch {
        r = { ok: false, error: 'common.genericError' }
      }
      setOutbox((cur) => cur.map((x) => (x.tid === p.tid ? { ...x, state: r.ok ? 'sent' : 'failed', error: r.ok ? undefined : tr(r.error ?? 'common.genericError') } : x)))
      // Sicherheitsnetz: gesendete Einträge verschwinden spätestens nach 8 s (Server-Nachricht ist dann da).
      if (r.ok) setTimeout(() => setOutbox((cur) => cur.filter((x) => !(x.tid === p.tid && x.state === 'sent'))), 8000)
    })
  }
  const send = (body: string, mentions: string, files: File[]) => {
    stick.current = true
    deliver({ tid: Math.random().toString(36).slice(2), body, mentions, files, state: 'sending', at: Date.now() })
  }

  // Scrollen: beim Öffnen zur ersten ungelesenen Nachricht, sonst ans Ende; neue Nachrichten nur,
  // wenn man bereits unten ist (sonst Hinweis «Neueste Nachrichten»).
  const stick = useRef(true)
  const [behind, setBehind] = useState(false)
  const lastId = messages[messages.length - 1]?.id
  const toEnd = () => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
    stick.current = true
    setBehind(false)
  }
  useEffect(() => {
    const el = box.current
    if (!el) return
    const mark = firstUnread ? el.querySelector<HTMLElement>('[data-unread-mark]') : null
    if (mark) el.scrollTop = Math.max(0, mark.offsetTop - el.offsetTop - 8)
    else el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const first = useRef(true)
  const failedCount = outbox.filter((p) => p.state === 'failed').length
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (stick.current) toEnd()
    else setBehind(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, outbox.length, failedCount])

  const mentionRe = useMemo(() => {
    const names = members.map((m) => esc(m.name)).sort((a, b) => b.length - a.length)
    return names.length ? new RegExp(`@(${names.join('|')})`, 'g') : null
  }, [members])
  const renderBody = (body: string) => {
    if (!mentionRe) return body
    const out: React.ReactNode[] = []
    let last = 0
    for (const m of body.matchAll(mentionRe)) {
      out.push(body.slice(last, m.index))
      out.push(<span key={m.index} className="mention">{m[0]}</span>)
      last = (m.index ?? 0) + m[0].length
    }
    out.push(body.slice(last))
    return out
  }

  const dayLabel = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    if (d.toDateString() === now.toDateString()) return t('common.today')
    if (d.toDateString() === y.toDateString()) return t('common.yesterday')
    return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
  }

  return (
    <>
      <div className="card-head chat-head">
        <div className="row" style={{ gap: 10, minWidth: 0, flexWrap: 'nowrap' }}>
          <Link className="btn ghost sm chat-back" href="/chat" aria-label={t('team.chat.back')}>←</Link>
          <div style={{ minWidth: 0 }}>
            <h2 className="ellipsis">{conv.title}</h2>
            <span className="small muted">{conv.kind === 'direct' ? t('team.chat.kinds.direct') : t('team.chat.members', { n: members.length })}</span>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {conv.clinical && <span className="tag violet">{t('team.chat.clinical')}</span>}
          <button type="button" className="btn sm" aria-expanded={showMembers} onClick={() => setShowMembers((v) => !v)}>{t('team.chat.membersTitle')}</button>
          <button type="button" className="btn sm ghost" onClick={() => run(() => muteAction(conv.id, !conv.muted))}>{t(conv.muted ? 'team.chat.unmute' : 'team.chat.mute')}</button>
        </div>
      </div>

      {conv.clinical && (
        <div className="alert info chat-notice" role="note">
          <span className="grow"><strong>{t('team.chat.clinicalNotice')}</strong>{t('team.chat.clinicalHint')}</span>
        </div>
      )}

      {showMembers && (
        <div className="chat-members">
          <ul className="list">
            {members.map((m) => (
              <li key={m.id} className="li" style={{ alignItems: 'center', padding: '6px 12px' }}>
                <span className="av sm muted">{m.initials}</span>
                <span className="grow">{m.name}{m.id === me && <span className="muted"> ({t('team.chat.you')})</span>}</span>
                <span className="small muted">{m.job}</span>
              </li>
            ))}
          </ul>
          {conv.kind !== 'direct' && (
            <div className="row" style={{ padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
              <form
                className="row grow"
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  run(() => addMemberAction(conv.id, f))
                }}
              >
                <select name="userId" className="field grow" defaultValue="" aria-label={t('team.chat.addMember')} style={{ maxWidth: 320 }}>
                  <option value="" disabled>{t('team.chat.addMember')}</option>
                  {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.hint ? ` · ${c.hint}` : ''}</option>)}
                </select>
                <button type="submit" className="btn sm">{t('team.chat.add')}</button>
              </form>
              <button type="button" className="btn sm danger" onClick={() => { if (window.confirm(t('team.chat.leaveConfirm'))) run(() => leaveConversationAction(conv.id)) }}>{t('team.chat.leave')}</button>
            </div>
          )}
        </div>
      )}

      <div className="chat-stage">
        <div
          className="msgs"
          ref={box}
          role="log"
          aria-live="polite"
          aria-label={conv.title}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            stick.current = atEnd
            if (atEnd && behind) setBehind(false)
          }}
        >
          {!messages.length && !shownOutbox.length && <p className="empty" style={{ margin: 'auto 0' }}>{t('team.chat.startHint')}</p>}
          {messages.map((m, i) => {
            const newDay = i === 0 || new Date(messages[i - 1].at).toDateString() !== new Date(m.at).toDateString()
            return (
              <Fragment key={m.id}>
                {newDay && <div className="chat-day"><span className="lbl">{dayLabel(m.at)}</span></div>}
                {m.id === firstUnread && <div className="chat-unread" data-unread-mark><span>{t('team.ux.newMessages')}</span></div>}
                <Message m={m} renderBody={renderBody} onRun={run} />
              </Fragment>
            )
          })}
          {shownOutbox.map((p) => (
            <div key={p.tid} className={'msg mine msg-pending' + (p.state === 'failed' ? ' is-failed' : '')} aria-busy={p.state !== 'failed' || undefined}>
              <span className="av">{self?.initials ?? '–'}</span>
              <div style={{ minWidth: 0 }}>
                <div className="mh">
                  <strong>{self?.name ?? t('team.chat.you')}</strong>
                  {p.state === 'failed'
                    ? <span className="crit-text" role="alert">✕ {t('team.ux.failed')}{p.error ? ' · ' + p.error : ''}</span>
                    : <span>{t('team.ux.sending')}</span>}
                </div>
                {p.body && <p>{renderBody(p.body)}</p>}
                {p.files.length > 0 && <ul className="chat-files">{p.files.map((f, i) => <li key={i}><span className="chip"><IconFile size={14} /> {f.name}</span></li>)}</ul>}
                {p.state === 'failed' && (
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    <button type="button" className="btn sm" onClick={() => deliver(p)}>{t('team.ux.retry')}</button>
                    <button type="button" className="btn sm ghost" onClick={() => setOutbox((cur) => cur.filter((x) => x.tid !== p.tid))}>{t('team.ux.discard')}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        {behind && <button type="button" className="btn sm chat-jump" onClick={toEnd}>↓ {t('team.ux.jumpLatest')}</button>}
      </div>

      <Composer members={members.filter((m) => m.id !== me)} onSend={send} />
    </>
  )
}

function Message({ m, renderBody, onRun }: { m: ChatMsg; renderBody: (s: string) => React.ReactNode; onRun: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [actions, setActions] = useState(false)
  const reactions = REACTIONS.map((r) => ({ ...r, ...(m.reactions.find((x) => x.symbol === r.symbol) ?? { n: 0, mine: false }) }))
  return (
    <div className={'msg' + (m.mine ? ' mine' : '')} data-open={actions || undefined}>
      <span className={'av' + (m.mine ? '' : ' muted')}>{m.initials}</span>
      <div style={{ minWidth: 0 }}>
        <div className="mh">
          <strong>{m.author}</strong>
          <time className="mono" dateTime={m.at}>{m.time}</time>
          {m.edited && !m.deleted && <span>· {t('team.chat.edited')}</span>}
          {!m.deleted && !editing && (
            <button type="button" className="msg-more" aria-expanded={actions} aria-label={t('team.ux.msgActions')} onClick={() => setActions((v) => !v)}>⋯</button>
          )}
          {!m.deleted && (
            <span className="mact">
              {reactions.filter((r) => r.n === 0).map((r) => (
                <button key={r.key} type="button" className="react-add" title={t('team.chat.reactions.' + r.key)} aria-label={t('team.chat.react', { r: t('team.chat.reactions.' + r.key) })} onClick={() => onRun(() => reactAction(m.id, r.key))}>{r.symbol}</button>
              ))}
              {m.mine && !editing && <button type="button" className="linkbtn small" onClick={() => { setDraft(m.body); setEditing(true) }}>{t('team.chat.edit')}</button>}
              {m.mine && !editing && <button type="button" className="linkbtn small crit-text" onClick={() => { if (window.confirm(t('team.chat.deleteConfirm'))) onRun(() => deleteMessageAction(m.id)) }}>{t('team.chat.delete')}</button>}
            </span>
          )}
        </div>
        {m.deleted ? (
          <p className="muted" style={{ fontStyle: 'italic' }}>{t('team.chat.deleted')}</p>
        ) : editing ? (
          <form
            className="stack-sm"
            style={{ marginTop: 4 }}
            onSubmit={(e) => {
              e.preventDefault()
              onRun(async () => {
                const r = await editMessageAction(m.id, draft)
                if (r.ok) setEditing(false)
                return r
              })
            }}
          >
            <textarea className="field" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label={t('team.chat.edit')} autoFocus />
            <div className="form-actions">
              <button type="submit" className="btn sm primary">{t('common.save')}</button>
              <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            </div>
          </form>
        ) : (
          m.body && <p>{renderBody(m.body)}</p>
        )}
        {m.files.length > 0 && (
          <ul className="chat-files">
            {m.files.map((f) => (
              <li key={f.id}><a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="chip"><IconFile size={14} /> {f.name}</a></li>
            ))}
          </ul>
        )}
        {reactions.some((r) => r.n > 0) && (
          <div className="reacts">
            {reactions.filter((r) => r.n > 0).map((r) => (
              <button key={r.key} type="button" aria-pressed={r.mine} title={t('team.chat.reactions.' + r.key)} aria-label={t('team.chat.react', { r: t('team.chat.reactions.' + r.key) }) + ` (${r.n})`} onClick={() => onRun(() => reactAction(m.id, r.key))}>
                {r.symbol} <span className="mono">{r.n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Eingabe mit @-Erwähnungen (Autovervollständigung der Mitglieder) und Anhängen. Enter sendet, Umschalt+Enter neue Zeile. */
function Composer({ members, onSend }: { members: Member[]; onSend: (body: string, mentions: string, files: File[]) => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [hi, setHi] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const hintId = useId()

  const matches = query == null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

  // Eingabefeld wächst bis 160 px mit.
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight + 2, 160) + 'px'
  }, [text])

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(^|\s)@([\p{L}\-]*(?: [\p{L}\-]*)?)$/u.exec(before)
    setQuery(m ? m[2] : null)
    setHi(0)
  }
  const pick = (m: Member) => {
    const el = ta.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@([\p{L}\-]*(?: [\p{L}\-]*)?)$/u, `@${m.name} `)
    const next = before + text.slice(caret)
    setText(next)
    setMentions((cur) => [...new Set([...cur, m.id])])
    setQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }
  const send = () => {
    if (!text.trim() && !files.length) {
      ta.current?.focus()
      return
    }
    const used = mentions.filter((id) => text.includes('@' + (members.find((m) => m.id === id)?.name ?? '\u0000'))).join(',')
    onSend(text, used, files)
    setText('')
    setMentions([])
    setFiles([])
    setQuery(null)
    if (fileRef.current) fileRef.current.value = ''
    ta.current?.focus()
  }

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }} style={{ position: 'relative', flexWrap: 'wrap' }}>
      {matches.length > 0 && (
        <div className="popover mention-pop">
          <ul className="menu" role="listbox" id={listId} aria-label={t('team.chat.mentionsTitle')}>
            {matches.map((m, i) => (
              <li key={m.id} id={`${listId}-${i}`} role="option" aria-selected={i === hi} className="mention-opt" onMouseDown={(e) => { e.preventDefault(); pick(m) }}>
                <span className="av sm muted" aria-hidden="true">{m.initials}</span>
                <span className="grow">{m.name}</span>
                <span className="small muted">{m.job}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {files.length > 0 && (
        <div className="chips" style={{ flexBasis: '100%' }}>
          {files.map((f, i) => (
            <button key={i} type="button" className="chip" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={t('team.ux.removeFile', { name: f.name })}>{f.name} <span aria-hidden="true">×</span></button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <button type="button" className="icon-btn composer-attach" onClick={() => fileRef.current?.click()} aria-label={t('team.chat.attach')} title={t('team.chat.attach')}><IconUpload size={18} /></button>
      <textarea
        ref={ta}
        className="field"
        rows={1}
        value={text}
        placeholder={t('team.chat.placeholder')}
        aria-label={t('team.chat.placeholder')}
        aria-describedby={hintId}
        aria-autocomplete="list"
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={matches.length ? `${listId}-${hi}` : undefined}
        enterKeyHint="send"
        onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart) }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi]); return }
            if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
        }}
      />
      <button type="submit" className="btn primary">{t('team.chat.send')}</button>
      <p className="composer-hint small muted" id={hintId}>{t('team.chat.composerHint')}</p>
    </form>
  )
}
