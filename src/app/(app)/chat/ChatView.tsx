'use client'

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react'
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

export function ChatView({ conv, me, members, candidates, messages, wasUnread }: {
  conv: Conv
  me: string
  members: Member[]
  candidates: { id: string; name: string; hint: string }[]
  messages: ChatMsg[]
  wasUnread: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [showMembers, setShowMembers] = useState(false)
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

  // Zum Ende scrollen bei neuen Nachrichten.
  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

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

      <div className="msgs" ref={box} aria-live="polite">
        {!messages.length && <p className="empty" style={{ margin: 'auto 0' }}>{t('team.chat.startHint')}</p>}
        {messages.map((m, i) => {
          const newDay = i === 0 || new Date(messages[i - 1].at).toDateString() !== new Date(m.at).toDateString()
          return (
            <Fragment key={m.id}>
              {newDay && <div className="chat-day"><span className="lbl">{dayLabel(m.at)}</span></div>}
              <Message m={m} renderBody={renderBody} onRun={run} />
            </Fragment>
          )
        })}
      </div>

      <Composer convId={conv.id} members={members.filter((m) => m.id !== me)} />
    </>
  )
}

function Message({ m, renderBody, onRun }: { m: ChatMsg; renderBody: (s: string) => React.ReactNode; onRun: (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const reactions = REACTIONS.map((r) => ({ ...r, ...(m.reactions.find((x) => x.symbol === r.symbol) ?? { n: 0, mine: false }) }))
  return (
    <div className={'msg' + (m.mine ? ' mine' : '')}>
      <span className={'av' + (m.mine ? '' : ' muted')}>{m.initials}</span>
      <div style={{ minWidth: 0 }}>
        <div className="mh">
          <strong>{m.author}</strong>
          <time className="mono" dateTime={m.at}>{m.time}</time>
          {m.edited && !m.deleted && <span>· {t('team.chat.edited')}</span>}
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

/** Eingabe mit @-Erwähnungen (Autovervollständigung der Mitglieder) und Anhängen. */
function Composer({ convId, members }: { convId: string; members: Member[] }) {
  const t = useT()
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [hi, setHi] = useState(0)
  const [files, setFiles] = useState<File[]>([])
  const [pending, start] = useTransition()
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)

  const matches = query == null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

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
    if (pending || (!text.trim() && !files.length)) return
    const f = new FormData()
    f.set('body', text)
    f.set('mentions', mentions.filter((id) => text.includes('@' + (members.find((m) => m.id === id)?.name ?? '\u0000'))).join(','))
    for (const x of files) f.append('files', x)
    start(async () => {
      const r = await sendMessageAction(convId, f)
      if (r.ok) {
        setText('')
        setMentions([])
        setFiles([])
        if (fileRef.current) fileRef.current.value = ''
      } else toast(tr(r.error), { kind: 'crit' })
    })
  }

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); send() }} style={{ position: 'relative', flexWrap: 'wrap' }}>
      {matches.length > 0 && (
        <div className="popover mention-pop" role="listbox" aria-label={t('team.chat.mentionsTitle')}>
          <ul className="menu">
            {matches.map((m, i) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={i === hi} style={i === hi ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined} onMouseDown={(e) => { e.preventDefault(); pick(m) }}>
                  <span className="av sm muted">{m.initials}</span>
                  <span className="grow">{m.name}</span>
                  <span className="small muted">{m.job}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {files.length > 0 && (
        <div className="chips" style={{ flexBasis: '100%' }}>
          {files.map((f, i) => (
            <button key={i} type="button" className="chip" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`${f.name} – ${t('common.delete')}`}>{f.name} ×</button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      <button type="button" className="icon-btn" style={{ width: 40, height: 40 }} onClick={() => fileRef.current?.click()} aria-label={t('team.chat.attach')} title={t('team.chat.attach')}><IconUpload size={18} /></button>
      <textarea
        ref={ta}
        className="field"
        rows={1}
        value={text}
        placeholder={t('team.chat.placeholder')}
        aria-label={t('team.chat.placeholder')}
        title={t('team.chat.composerHint')}
        onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart) }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi]); return }
            if (e.key === 'Escape') { setQuery(null); return }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
        }}
      />
      <button type="submit" className="btn primary" data-loading={pending || undefined} disabled={pending}>{t('team.chat.send')}</button>
    </form>
  )
}
