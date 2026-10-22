'use client'

import { Fragment, useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconCheck } from '@/components/icons'
import { assignTaskAction, completeManyAction, completeTaskAction, createTaskAction, escalateTaskAction, reopenManyAction, reopenTaskAction, startTaskAction } from '@/app/(app)/tasks/actions'
import { isKey, useCall } from '@/components/meds/shared'
import { isOffline, isQueued, orQueue } from '@/lib/offline/client'
import { dueView } from '@/lib/task-view'
import { Checkbox, DateField, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'

export type TaskRowDto = {
  id: string
  time: string
  day: string | null
  title: string
  description: string | null
  category: string
  catTone: string
  durationMin: number
  priority: 'critical' | 'important' | 'routine'
  view: 'done' | 'partial' | 'skipped' | 'escalated' | 'in_progress' | 'over' | 'due' | 'up'
  /** Fälligkeit (ISO): Zustand nach dem Wiederöffnen clientseitig ableiten */
  due: string
  resident: { id: string; name: string; room: string | null } | null
  assignee: { id: string; initials: string; name: string } | null
  completed: string | null
  note: string | null
  createdBy: string | null
  sourceLabel: string
  /** Medikamenten-Zeitpunkt (über Abgabeliste) oder Wirkungskontrolle: Link statt Quittieren. */
  link: { href: string; label: string } | null
}
export type StaffDto = { id: string; name: string; initials: string }

type Mode = 'assign' | 'partial' | 'skipped' | 'escalate' | 'details'

/** Universal Action System (PRD §49): Create · Assign · Complete · Review · Escalate – als einheitliche Zeilenaktionen. */
export function TaskTable({ rows: serverRows, staff, canManage, canComplete, meId, emptyText }: {
  rows: TaskRowDto[]
  staff: StaffDto[]
  canManage: boolean
  canComplete: boolean
  meId: string
  emptyText: string
}) {
  const t = useT()
  const { pending, call } = useCall()
  const [dlg, setDlg] = useState<{ row: TaskRowDto; mode: Mode } | null>(null)
  const [bulk, setBulk] = useState<TaskRowDto[] | null>(null)
  const [menu, setMenuState] = useState<{ id: string; top?: number; bottom?: number; right: number } | null>(null)
  // Auslöser des offenen Menüs: Fokus kehrt nach Esc oder nach Wahl einer Aktion dorthin zurück (WCAG 2.4.3)
  const menuBtn = useRef<HTMLElement | null>(null)
  const openMenu = (id: string, el: HTMLElement) => {
    if (menu?.id === id) return setMenuState(null)
    menuBtn.current = el
    const b = el.getBoundingClientRect()
    // Nach oben öffnen, wenn unten (über der Bottom-Nav) kein Platz ist – sonst liegen Aktionen verdeckt
    const up = window.innerHeight - b.bottom < 300 && b.top > 300
    setMenuState({ id, ...(up ? { bottom: window.innerHeight - b.top + 4 } : { top: b.bottom + 4 }), right: Math.max(8, window.innerWidth - b.right) })
  }
  const setMenu = (v: null) => setMenuState(v)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenuState(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuState(null); menuBtn.current?.focus() } }
    const off = () => setMenuState(null)
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', off)
    document.addEventListener('scroll', off, true)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', off); document.removeEventListener('scroll', off, true) }
  }, [menu])

  const done = (row: TaskRowDto) => row.view === 'done' || row.view === 'partial' || row.view === 'skipped'

  // Schnellquittierung optimistisch (PRD §31): Status sofort, bei Fehler zurück und Hinweis. Live-Updates anderer
  // Personen setzen auf die neuen Server-Daten auf, ohne den eigenen, noch laufenden Status zu überschreiben.
  const [, startQuick] = useTransition()
  const [optView, setOptView] = useOptimistic<Record<string, TaskRowDto['view']>, { id: string; view: TaskRowDto['view'] }>({}, (cur, u) => ({ ...cur, [u.id]: u.view }))
  // Ohne Verbindung vorgemerkt: bis zur Synchronisation als erledigt mit Hinweis «Offline erfasst» (PRD §39)
  const [queued, setQueued] = useState<Record<string, true>>({})
  const inflight = useRef(new Set<string>())
  const rows = serverRows.map((r) => (queued[r.id] && !done(r) ? { ...r, view: 'done' as const } : optView[r.id] ? { ...r, view: optView[r.id] } : r))
  const tr = (s: string) => (isKey(s) ? t(s) : s)
  const act = (row: TaskRowDto, reopen: boolean) => {
    // Doppelklick: solange die Aktion für diese Zeile läuft, keine zweite Buchung
    if (!canComplete || inflight.current.has(row.id)) return
    if (reopen && (queued[row.id] || isOffline())) return void toast(t('common.offlineSync.notOffline'), { kind: 'crit' })
    inflight.current.add(row.id)
    startQuick(async () => {
      setOptView({ id: row.id, view: reopen ? dueView(new Date(row.due)) : 'done' })
      try {
        const f = new FormData()
        f.set('id', row.id)
        if (reopen) {
          const r = await reopenTaskAction(f)
          if (!r.ok) toast(tr(r.error), { kind: 'crit', ms: 6000 })
          return
        }
        f.set('status', 'done')
        const r = row.resident
          ? await orQueue(() => completeTaskAction(f), { kind: 'task', residentId: row.resident.id, data: { taskId: row.id, status: 'done' } }, { who: row.resident.name, label: row.title })
          : await completeTaskAction(f)
        if (isQueued(r)) { setQueued((c) => ({ ...c, [row.id]: true })); return void toast(t(r.message)) }
        if (!r.ok) return void toast(tr(r.error), { kind: 'crit', ms: 6000 })
        toast(t('tasks.toast.done', { title: row.title }), { undo: () => act({ ...row, view: 'done' }, true), undoLabel: t('common.undo') })
      } catch {
        toast(t('common.genericError'), { kind: 'crit', ms: 6000 })
      } finally {
        inflight.current.delete(row.id)
      }
    })
  }
  const quick = (row: TaskRowDto) => act(row, done(row))

  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>{emptyText}</p>

  // Sammelquittierung: gleiche Massnahme zur gleichen Zeit bei mindestens 3 Personen (z. B. Kontrollgang 21:30)
  const groupKey = (r: TaskRowDto) => `${r.day ?? ''}|${r.time}|${r.title}`
  const groups = new Map<string, TaskRowDto[]>()
  if (canComplete) for (const r of rows) if (!done(r) && !r.link) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r])
  const groupStart = new Map<string, TaskRowDto[]>()
  for (const g of groups.values()) if (g.length >= 3) groupStart.set(g[0].id, g)

  return (
    <>
      <div className="tablewrap task-table">
        <table className="stable">
          <thead>
            <tr>
              <th>{t('tasks.col.time')}</th>
              <th>{t('tasks.col.resident')}</th>
              <th>{t('tasks.col.task')}</th>
              <th className="hide-sm">{t('tasks.col.category')}</th>
              <th className="hide-sm">{t('tasks.col.assignee')}</th>
              <th className="right">{t('tasks.col.complete')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const closed = done(row)
              const grp = groupStart.get(row.id)
              return (
                <Fragment key={row.id}>
                {grp && (
                  <tr className="grp-row">
                    <td colSpan={6}>
                      <div className="row-between">
                        <span><span className="mono">{row.time}</span> · <strong>{row.title}</strong> · <span className="muted">{t('tasks.bulk.count', { n: grp.length })}</span></span>
                        <button type="button" className="btn sm" disabled={pending} onClick={() => setBulk(grp)}>{t('tasks.bulk.button', { n: grp.length })}</button>
                      </div>
                    </td>
                  </tr>
                )}
                <tr className={row.view === 'over' ? 'over' : ''}>
                  <td className="mono nowrap tt-time">
                    {row.time}
                    {row.day && <div className="small muted">{row.day}</div>}
                    {row.view === 'over' && <div className="small">{t('tasks.view.over')}</div>}
                    {row.view === 'due' && <div className="small warn-text">{t('tasks.view.due')}</div>}
                  </td>
                  <td className="tt-res">
                    {row.resident ? (
                      <>
                        <Link className="linkbtn" href={`/residents/${row.resident.id}`}>{row.resident.name}</Link>
                        {row.resident.room && <div className="small muted mono">{t('meds.roomShort', { room: row.resident.room })}</div>}
                      </>
                    ) : <span className="muted">{t('tasks.noResident')}</span>}
                  </td>
                  <td className="tt-task" style={closed ? { color: 'var(--fg-3)' } : undefined}>
                    <span style={row.view === 'done' ? { textDecoration: 'line-through', textDecorationColor: 'var(--line-strong)' } : undefined}>{row.title}</span>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      <span className="small muted">{t('tasks.minutes', { n: row.durationMin })}</span>
                      {row.priority !== 'routine' && <span className={'tag ' + (row.priority === 'critical' ? 'crit' : 'warn')}>{t('common.priority.' + row.priority)}</span>}
                      {row.view === 'in_progress' && <span className="tag accent">{t('tasks.view.in_progress')}</span>}
                      {row.view === 'escalated' && <span className="tag crit">{t('tasks.view.escalated')}</span>}
                      {queued[row.id] && <span className="tag outline">{t('common.offlineSync.tag')}</span>}
                      {(row.view === 'partial' || row.view === 'skipped') && <span className="tag warn">{t('tasks.view.' + row.view)}</span>}
                    </div>
                    {row.description && !closed && <div className="small fg2" style={{ maxWidth: '60ch' }}>{row.description}</div>}
                    {row.note && <div className="small fg2">{t('tasks.noteLabel')}: {row.note}</div>}
                    {row.completed && <div className="small muted">{row.completed}</div>}
                  </td>
                  <td className="hide-sm"><span className={'tag ' + row.catTone}>{row.category}</span></td>
                  <td className="nowrap hide-sm">
                    {row.assignee ? <span className="row" style={{ gap: 6 }}><span className="av sm">{row.assignee.initials}</span><span className="small">{row.assignee.id === meId ? t('tasks.me') : row.assignee.name}</span></span> : <span className="small muted">–</span>}
                  </td>
                  <td className="right nowrap tt-act">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap', position: 'relative' }} data-menu>
                      <button type="button" className="btn ghost sm row-menu" aria-expanded={menu?.id === row.id} aria-label={t('tasks.actions.menuFor', { title: row.title })} onClick={(e) => openMenu(row.id, e.currentTarget)}>⋯</button>
                      {menu?.id === row.id && (
                        <div className="popover" style={{ position: 'fixed', width: 230, top: menu.top, bottom: menu.bottom, right: menu.right, textAlign: 'left' }} onClick={() => menuBtn.current?.focus()}>
                          <ul className="menu">
                            {!closed && canComplete && row.view !== 'in_progress' && !row.link && <li><button type="button" onClick={() => { setMenu(null); call(startTaskAction, { id: row.id }) }}>{t('tasks.actions.start')}</button></li>}
                            {!closed && canManage && <li><button type="button" onClick={() => { setMenu(null); setDlg({ row, mode: 'assign' }) }}>{t('tasks.actions.assign')}</button></li>}
                            {!closed && canComplete && !row.assignee && !canManage && <li><button type="button" onClick={() => { setMenu(null); call(startTaskAction, { id: row.id }) }}>{t('tasks.actions.takeOver')}</button></li>}
                            {!closed && canComplete && !row.link && <li><button type="button" onClick={() => { setMenu(null); setDlg({ row, mode: 'partial' }) }}>{t('tasks.actions.partial')}</button></li>}
                            {!closed && canComplete && !row.link && <li><button type="button" onClick={() => { setMenu(null); setDlg({ row, mode: 'skipped' }) }}>{t('tasks.actions.skip')}</button></li>}
                            {!closed && canComplete && row.view !== 'escalated' && <li><button type="button" style={{ color: 'var(--crit)' }} onClick={() => { setMenu(null); setDlg({ row, mode: 'escalate' }) }}>{t('tasks.actions.escalate')}</button></li>}
                            {closed && canComplete && !row.link && <li><button type="button" onClick={() => { setMenu(null); call(reopenTaskAction, { id: row.id }) }}>{t('tasks.actions.reopen')}</button></li>}
                            <li><button type="button" onClick={() => { setMenu(null); setDlg({ row, mode: 'details' }) }}>{t('tasks.actions.details')}</button></li>
                          </ul>
                        </div>
                      )}
                      {row.link && !closed ? (
                        <Link className="btn sm" href={row.link.href}>{row.link.label}</Link>
                      ) : (
                        <button
                          type="button"
                          className="chk"
                          style={{ display: 'inline-grid' }}
                          aria-pressed={row.view === 'done'}
                          data-state={row.view === 'partial' || row.view === 'skipped' ? row.view : undefined}
                          disabled={!canComplete || pending || (closed && !!row.link)}
                          onClick={() => quick(row)}
                          aria-label={t(closed ? 'tasks.actions.reopenFor' : 'tasks.actions.completeFor', { title: row.title })}
                          title={t(closed ? 'tasks.actions.reopen' : 'tasks.actions.complete')}
                        >
                          {row.view === 'partial' ? '△' : row.view === 'skipped' ? '✕' : <IconCheck />}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {dlg && <RowDialog key={dlg.row.id + dlg.mode} row={dlg.row} mode={dlg.mode} staff={staff} onClose={() => setDlg(null)} />}
      {bulk && (
        <BulkDialog rows={bulk} onClose={() => setBulk(null)} onDone={(ids, msg) => {
          setBulk(null)
          toast(msg, ids.length ? { undoLabel: t('common.undo'), undo: () => call(reopenManyAction, { ids: ids.join(',') }) } : {})
        }} />
      )}
    </>
  )
}

/** Bestätigung der Sammelquittierung mit Liste aller Personen (eindeutige Zuordnung, PRD §32); Undo im Toast. */
function BulkDialog({ rows, onClose, onDone }: { rows: TaskRowDto[]; onClose: () => void; onDone: (ids: string[], message: string) => void }) {
  const t = useT()
  const { pending, call } = useCall()
  const first = rows[0]
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)))
  const toggle = (id: string) => setSel((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const confirm = () => call(completeManyAction, { ids: [...sel].join(',') }, (r) => {
    if (r.ok) onDone((r.data as { ids?: string[] } | undefined)?.ids ?? [], r.message ?? '')
  }, true)
  return (
    <Dialog open onClose={onClose} title={t('tasks.bulk.title')}>
      <p style={{ margin: 0 }}><span className="mono">{first.time}</span> · <strong style={{ fontWeight: 500 }}>{first.title}</strong> <span className={'tag ' + first.catTone}>{first.category}</span></p>
      <ul className="list card bulk-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Checkbox checked={sel.has(r.id)} onChange={() => toggle(r.id)} label={<>{r.resident?.room && <span className="roomtag">{r.resident.room}</span>}
              <span className="grow">{r.resident?.name ?? t('tasks.noResident')}</span>
              {r.view === 'over' && <span className="tag crit">{t('tasks.view.over')}</span>}</>} wrapClassName="li bulk-item" />
          </li>
        ))}
      </ul>
      <p className="small fg2" style={{ margin: 0 }}>{t('tasks.bulk.hint')}</p>
      <div className="form-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn primary" disabled={pending || !sel.size} data-loading={pending || undefined} onClick={confirm}>{t('tasks.bulk.confirm', { n: sel.size })}</button>
      </div>
    </Dialog>
  )
}

function RowDialog({ row, mode, staff, onClose }: { row: TaskRowDto; mode: Mode; staff: StaffDto[]; onClose: () => void }) {
  const t = useT()
  const context = row.resident ? <><strong>{row.resident.name}</strong>{row.resident.room && <span className="mono">{t('meds.roomShort', { room: row.resident.room })}</span>}</> : undefined
  const head = (
    <p style={{ margin: 0 }}>
      <span className="mono">{row.time}</span> · <strong style={{ fontWeight: 500 }}>{row.title}</strong> <span className={'tag ' + row.catTone}>{row.category}</span>
    </p>
  )
  const foot = (label: string, cls = 'btn primary') => (
    <div className="form-actions">
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
      <button type="submit" className={cls}>{label}</button>
    </div>
  )
  if (mode === 'details') {
    return (
      <Dialog open onClose={onClose} title={t('tasks.details.title')} context={context}>
        {head}
        {row.description && <p className="fg2" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.description}</p>}
        <dl className="kv">
          <dt>{t('tasks.details.status')}</dt><dd>{t('tasks.view.' + row.view)}</dd>
          <dt>{t('tasks.details.source')}</dt><dd>{row.sourceLabel}</dd>
          <dt>{t('tasks.details.duration')}</dt><dd>{t('tasks.minutes', { n: row.durationMin })}</dd>
          <dt>{t('tasks.details.priority')}</dt><dd>{t('common.priority.' + row.priority)}</dd>
          <dt>{t('tasks.col.assignee')}</dt><dd>{row.assignee?.name ?? '–'}</dd>
          {row.createdBy && <><dt>{t('tasks.details.createdBy')}</dt><dd>{row.createdBy}</dd></>}
          {row.completed && <><dt>{t('tasks.details.completed')}</dt><dd>{row.completed}</dd></>}
          {row.note && <><dt>{t('tasks.noteLabel')}</dt><dd>{row.note}</dd></>}
        </dl>
        <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>{t('common.close')}</button></div>
      </Dialog>
    )
  }
  if (mode === 'assign') {
    return (
      <Dialog open onClose={onClose} title={t('tasks.actions.assign')} context={context}>
        <ActionForm action={assignTaskAction} onDone={(r) => r.ok && onClose()}>
          <input type="hidden" name="id" value={row.id} />
          {head}
          <Select label={t('tasks.col.assignee')} name="assigneeId" defaultValue={row.assignee?.id ?? ''}>
              <option value="">{t('tasks.unassigned')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.initials})</option>)}
            </Select>
          {foot(t('tasks.actions.assignSave'))}
        </ActionForm>
      </Dialog>
    )
  }
  if (mode === 'escalate') {
    return (
      <Dialog open onClose={onClose} title={t('tasks.escalate.title')} context={context}>
        <ActionForm action={escalateTaskAction} onDone={(r) => r.ok && onClose()}>
          <input type="hidden" name="id" value={row.id} />
          {head}
          <p className="small fg2" style={{ margin: 0 }}>{t('tasks.escalate.hint')}</p>
          <Textarea label={t('tasks.escalate.reason')} name="reason" rows={3} required placeholder={t('tasks.escalate.reasonPh')} />
          {foot(t('tasks.actions.escalate'), 'btn danger solid')}
        </ActionForm>
      </Dialog>
    )
  }
  return (
    <Dialog open onClose={onClose} title={t(mode === 'partial' ? 'tasks.complete.partialTitle' : 'tasks.complete.skipTitle')} context={context}>
      <ActionForm action={completeTaskAction} onDone={(r) => r.ok && onClose()}>
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="status" value={mode} />
        {head}
        <Textarea label={t('tasks.complete.reason')} name="reason" rows={3} required placeholder={t(mode === 'partial' ? 'tasks.complete.partialPh' : 'tasks.complete.skipPh')} />
        {foot(t(mode === 'partial' ? 'tasks.actions.partial' : 'tasks.actions.skip'))}
      </ActionForm>
    </Dialog>
  )
}

/** Merkt sich den gewählten Filter pro Person (30 Tage), damit /tasks beim nächsten Aufruf gleich aussieht. */
export function RememberFilter({ userId, value }: { userId: string; value: string }) {
  useEffect(() => {
    try { document.cookie = `careos_tasks_f_${userId}=${encodeURIComponent(value)}; path=/; max-age=${30 * 86400}; samesite=lax` } catch { /* Cookies gesperrt: Filter gilt nur für diesen Aufruf */ }
  }, [userId, value])
  return null
}

/** Create: Aufgabe erfassen. `?new=1` öffnet den Dialog direkt (Schnellaktion, Befehlspalette). */
export function CreateTask({ initialOpen, residents, staff, categories, todayKey, defaultTime, meId }: {
  initialOpen: boolean
  residents: { id: string; name: string; room: string | null }[]
  staff: StaffDto[]
  categories: string[]
  todayKey: string
  defaultTime: string
  meId: string
}) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(initialOpen)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setTimeout(() => first.current?.focus(), 30) }, [open])
  const close = () => {
    setOpen(false)
    if (initialOpen) router.replace('/tasks', { scroll: false })
  }
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('tasks.create.button')}</button>
      {open && (
        <Dialog open onClose={close} title={t('tasks.create.title')} wide>
          <ActionForm action={createTaskAction} success="tasks.toast.created" onDone={(r) => r.ok && close()}>
            <div className="form-grid">
              <TextField label={t('tasks.create.titleField')} wrapClassName="span-all" ref={first} name="title" required maxLength={200} placeholder={t('tasks.create.titlePh')} />
              <Select label={<>{t('tasks.col.resident')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></>} name="residentId" defaultValue="">
                  <option value="">{t('tasks.create.noResident')}</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.room ? r.room + ' · ' : ''}{r.name}</option>)}
                </Select>
              <label className="fld">
                <span className="lbl">{t('tasks.col.category')}</span>
                <TextField name="category" list="task-cats" defaultValue="" placeholder={t('tasks.categoryDefault')} />
                <datalist id="task-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <DateField label={t('tasks.create.date')} name="date" defaultValue={todayKey} required />
              <TimeField label={t('tasks.create.time')} name="time" defaultValue={defaultTime} required />
              <TextField label={t('tasks.details.duration')} name="durationMin" inputMode="numeric" defaultValue="10" className="mono" />
              <Select label={t('tasks.details.priority')} name="priority" defaultValue="routine">
                  {(['routine', 'important', 'critical'] as const).map((p) => <option key={p} value={p}>{t('common.priority.' + p)}</option>)}
                </Select>
              <Select label={t('tasks.col.assignee')} name="assigneeId" defaultValue="">
                  <option value="">{t('tasks.unassigned')}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.id === meId ? t('tasks.me') + ' – ' : ''}{s.name} ({s.initials})</option>)}
                </Select>
              <Textarea label={<>{t('tasks.create.description')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></>} wrapClassName="span-all" name="description" rows={3} />
            </div>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.create')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}
