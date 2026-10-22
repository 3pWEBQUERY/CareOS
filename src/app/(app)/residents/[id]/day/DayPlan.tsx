'use client'

import { useOptimistic, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconCheck, IconPlus } from '@/components/icons'
import { createTask, documentTask, toggleTask } from './actions'
import { isOffline, isQueued, orQueue } from '@/lib/offline/client'
import type { TaskData } from '@/lib/offline/types'

export type DayTask = {
  id: string; time: string; due: string; title: string; description: string | null; category: string; tone: string; min: number
  status: string; view: string; source: string; at: string | null; by: string | null; note: string | null
}

const CLOSED = ['done', 'partial', 'skipped']

export function DayPlan({ residentId, who, tasks, dateLabel, canComplete, canManage, categories, now, me }: {
  residentId: string; who: string; tasks: DayTask[]; dateLabel: string; canComplete: boolean; canManage: boolean
  categories: { value: string; label: string }[]; now: string; me: string
}) {
  const t = useT()
  const [, start] = useTransition()
  const [optBase, setOpt] = useOptimistic(tasks, (cur: DayTask[], u: { id: string; done: boolean; at: string }) =>
    cur.map((k) => (k.id === u.id ? { ...k, status: u.done ? 'done' : 'planned', view: u.done ? 'done' : reView(k, now), at: u.done ? u.at : null, by: u.done ? me : null } : k)),
  )
  // Offline vorgemerkte Abschlüsse bis zur Synchronisation als erledigt zeigen (PRD §39)
  const [queued, setQueued] = useState<Record<string, { status: string; at: string }>>({})
  const offTag = t('common.offlineSync.marker')
  const opt = optBase.map((k) => {
    const q = queued[k.id]
    return q && !CLOSED.includes(k.status) ? { ...k, status: q.status, view: 'done', at: q.at, by: `${me} · ${offTag}` } : k
  })
  const markQueued = (id: string, status: string) => setQueued((cur) => ({ ...cur, [id]: { status, at: hmLocal(new Date()) } }))
  const [doc, setDoc] = useState<DayTask | null>(null)
  const [adding, setAdding] = useState(false)
  const nowD = new Date(now)
  const nowLabel = `${t('common.now')} ${hmLocal(nowD)}`

  const toggle = (k: DayTask, done: boolean) => {
    if (!done && (isOffline() || queued[k.id])) return void toast(t('common.offlineSync.notOffline'), { kind: 'crit' })
    start(async () => {
      setOpt({ id: k.id, done, at: hmLocal(new Date()) })
      const r = done
        ? await orQueue(() => toggleTask(k.id, done), { kind: 'task', residentId, data: { taskId: k.id, status: 'done' } }, { who, label: k.title })
        : await toggleTask(k.id, done)
      if (isQueued(r)) { markQueued(k.id, 'done'); return void toast(t(r.message)) }
      if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
      toast(t(done ? 'chart.day.toastDone' : 'chart.day.toastOpen', { title: k.title }), {
        undo: () => start(async () => { setOpt({ id: k.id, done: !done, at: hmLocal(new Date()) }); await toggleTask(k.id, !done) }),
        undoLabel: t('common.undo'),
      })
    })
  }

  const done = opt.filter((k) => CLOSED.includes(k.status))
  const mDone = done.reduce((a, k) => a + k.min, 0)
  const mTot = opt.reduce((a, k) => a + k.min, 0)
  const over = opt.filter((k) => k.view === 'over').length
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

  let nowPlaced = false
  const rows: React.ReactNode[] = []
  for (const k of opt) {
    if (!nowPlaced && new Date(k.due) > nowD) {
      rows.push(<NowRow key="now" label={nowLabel} />)
      nowPlaced = true
    }
    rows.push(<Row key={k.id} k={k} residentId={residentId} canComplete={canComplete} onToggle={toggle} onOpen={() => setDoc(k)} />)
  }
  if (!nowPlaced) rows.push(<NowRow key="now" label={nowLabel} />)

  return (
    <>
      <div className="metrics">
        <div className="metric">
          <span className="lbl">{t('chart.day.mDone')}</span>
          <span className="val">{done.length} <small>/ {opt.length}</small></span>
          <div className="bar"><i style={{ width: pct(done.length, opt.length) + '%' }} /></div>
        </div>
        <div className="metric">
          <span className="lbl">{t('chart.day.mTime')}</span>
          <span className="val">{mDone} <small>/ {mTot} {t('common.minutes')}</small></span>
          <div className="bar"><i style={{ width: pct(mDone, mTot) + '%' }} /></div>
        </div>
        <div className="metric">
          <span className="lbl">{t('chart.day.mOver')}</span>
          <span className={'val' + (over ? ' crit' : '')}>{over}</span>
          <span className="small muted">{t(over ? 'chart.day.overHint' : 'chart.day.onTime')}</span>
        </div>
      </div>

      <div className="sec-head">
        <h2 className="sec">{t('chart.day.title', { date: dateLabel })}</h2>
        <div className="row">
          <span className="small muted">{t('chart.day.hint')}</span>
          {canManage && <button type="button" className="btn sm" onClick={() => setAdding(true)}><IconPlus size={14} />{t('chart.day.add')}</button>}
        </div>
      </div>
      {opt.length ? <ol className="timeline">{rows}</ol> : <p className="empty">{t('chart.day.empty')}</p>}

      <QuickDoc task={doc} who={who} residentId={residentId} onQueued={markQueued} onClose={() => setDoc(null)} />

      <Dialog open={adding} onClose={() => setAdding(false)} title={t('chart.day.add')} context={<span>{who}</span>}>
        <ActionForm action={createTask.bind(null, residentId)} success="chart.day.added" onDone={(r) => r.ok && setAdding(false)}>
          <div className="form-grid">
            <label className="fld span-all"><span className="lbl">{t('chart.day.fTitle')}</span><input className="field" name="title" required maxLength={200} /></label>
            <label className="fld"><span className="lbl">{t('chart.day.fTime')}</span><input className="field mono" name="time" type="time" required defaultValue={defaultTime(nowD)} /></label>
            <label className="fld"><span className="lbl">{t('chart.day.fDuration')}</span><input className="field mono" name="durationMin" inputMode="numeric" defaultValue="10" /></label>
            <label className="fld"><span className="lbl">{t('chart.day.fCategory')}</span>
              <select className="field" name="category" defaultValue={categories[0]?.value}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            </label>
            <label className="fld"><span className="lbl">{t('chart.day.fPriority')}</span>
              <select className="field" name="priority" defaultValue="routine">
                {['routine', 'important', 'critical'].map((p) => <option key={p} value={p}>{t('common.priority.' + p)}</option>)}
              </select>
            </label>
            <label className="fld span-all"><span className="lbl">{t('chart.day.fDescription')} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></span><textarea className="field" name="description" rows={2} /></label>
          </div>
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setAdding(false)}>{t('common.cancel')}</button><button type="submit" className="btn primary">{t('chart.day.add')}</button></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

function reView(k: DayTask, now: string) {
  const diff = (new Date(k.due).getTime() - new Date(now).getTime()) / 60000
  return diff < -15 ? 'over' : diff <= 30 ? 'due' : 'up'
}
const pad = (n: number) => String(n).padStart(2, '0')
const hmLocal = (d: Date) => pad(d.getHours()) + ':' + pad(d.getMinutes())
const defaultTime = (d: Date) => pad(Math.min(23, d.getHours() + 1)) + ':00'

function NowRow({ label }: { label: string }) {
  return <li className="now" aria-label={label}><span>{label}</span><i /></li>
}

function Row({ k, residentId, canComplete, onToggle, onOpen }: { k: DayTask; residentId: string; canComplete: boolean; onToggle: (k: DayTask, done: boolean) => void; onOpen: () => void }) {
  const t = useT()
  const closed = CLOSED.includes(k.status)
  const isMed = k.source === 'medication'
  const sub = k.status === 'done' ? t('chart.day.subDone', { at: k.at ?? '', by: k.by ?? '' })
    : k.status === 'partial' ? t('chart.day.subPartial', { at: k.at ?? '', by: k.by ?? '' }) + (k.note ? ' · ' + k.note : '')
    : k.status === 'skipped' ? t('chart.day.subSkipped', { by: k.by ?? '' }) + (k.note ? ' · ' + k.note : '')
    : k.view === 'over' ? t('chart.day.subOver', { time: k.time })
    : k.view === 'due' ? t('chart.day.subDue')
    : k.status === 'escalated' ? t('chart.day.subEscalated')
    : k.status === 'in_progress' ? t('chart.day.subInProgress')
    : t('chart.day.subPlanned')
  const cls = 'trow is-' + (k.status === 'done' || k.status === 'partial' ? 'done' : k.status === 'skipped' ? 'skipped' : k.view)
  const state = k.status === 'partial' ? 'partial' : k.status === 'skipped' ? 'skipped' : undefined
  const mark = k.status === 'partial' ? '△' : k.status === 'skipped' ? '✕' : <IconCheck />
  return (
    <li className={cls}>
      <span className="t mono">{k.time}</span>
      {isMed || !canComplete ? (
        <span className="chk" aria-hidden="true" data-state={state} {...(k.status === 'done' ? { 'aria-pressed': 'true' } : {})} style={{ cursor: 'default' }}>{mark}</span>
      ) : (
        <button type="button" className="chk" aria-pressed={closed} data-state={state}
          aria-label={k.title + ' ' + t(closed ? 'chart.day.markOpen' : 'chart.day.markDone')}
          onClick={() => onToggle(k, !closed)}>{mark}</button>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="ttl">
          {isMed ? <Link href={`/residents/${residentId}/meds`}>{k.title} →</Link>
            : canComplete ? <button type="button" className="linkbtn" style={{ color: 'inherit', fontWeight: 500, textDecoration: 'inherit' }} onClick={onOpen}>{k.title}</button>
            : k.title}
        </div>
        <div className="sub">{isMed && !closed ? t('chart.day.subMed') : sub}</div>
      </div>
      <span className={'tag ' + k.tone}>{k.category}</span>
      <span className="mins mono">{k.min} {t('common.minutes')}</span>
    </li>
  )
}

function QuickDoc({ task, who, residentId, onQueued, onClose }: { task: DayTask | null; who: string; residentId: string; onQueued: (id: string, status: string) => void; onClose: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<string>('done')
  const [showNote, setShowNote] = useState(false)
  const [key, setKey] = useState('')
  if (task && key !== task.id) {
    setKey(task.id)
    setStatus(CLOSED.includes(task.status) ? task.status : 'done')
    setShowNote(false)
  }
  const opts = [
    { v: 'done', sym: '✓', label: t('chart.day.qdDone') },
    { v: 'partial', sym: '△', label: t('chart.day.qdPartial') },
    { v: 'skipped', sym: '✕', label: t('chart.day.qdSkipped') },
  ]
  return (
    <Dialog open={!!task} onClose={onClose} title={task?.title ?? ''} context={<span>{who} · <span className="mono">{task?.time}</span></span>}>
      {task && (
        <ActionForm action={async (form) => {
          // Ohne Verbindung: verschlüsselt vormerken und später synchronisieren (PRD §39)
          const st = String(form.get('status') ?? '') as TaskData['status']
          const reason = String(form.get('reason') ?? '').trim()
          const note = String(form.get('note') ?? '').trim()
          if (st !== 'done' && reason.length < 3 && isOffline()) return { ok: false as const, error: 'chart.day.errors.reason', field: 'reason' }
          const r = await orQueue(() => documentTask(form), { kind: 'task', residentId, data: { taskId: task.id, status: st, reason: reason || undefined, note: note || undefined } }, { who, label: task.title })
          if (isQueued(r)) { onQueued(task.id, st); return { ok: true as const, message: r.message } }
          return r
        }} success="chart.day.documented" onDone={(r) => r.ok && onClose()}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="status" value={status} />
          {task.description && <p className="small fg2" style={{ margin: 0 }}>{task.description}</p>}
          <div className="fld">
            <span className="lbl" id="qd-lbl">{t('chart.day.qdStatus')}</span>
            <div className="quickdoc" role="group" aria-labelledby="qd-lbl">
              {opts.map((o) => (
                <button key={o.v} type="button" data-v={o.v} aria-pressed={status === o.v} onClick={() => setStatus(o.v)}>
                  <span aria-hidden="true">{o.sym}</span>{o.label}
                </button>
              ))}
            </div>
          </div>
          {status !== 'done' && (
            <label className="fld"><span className="lbl">{t('chart.day.qdReason')}</span>
              <textarea className="field" name="reason" rows={2} required placeholder={t('chart.day.qdReasonPh')} />
            </label>
          )}
          {showNote ? (
            <label className="fld"><span className="lbl">{t('chart.day.qdNote')}</span>
              <textarea className="field" name="note" rows={3} autoFocus placeholder={t('chart.day.qdNotePh')} />
              <span className="hint">{t('chart.day.qdNoteHint')}</span>
            </label>
          ) : (
            <button type="button" className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowNote(true)}>+ {t('chart.day.qdAddNote')}</button>
          )}
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="btn primary">{t('common.save')}</button></div>
        </ActionForm>
      )}
    </Dialog>
  )
}
