'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconCheck } from '@/components/icons'
import { assignTaskAction, completeTaskAction, createTaskAction, escalateTaskAction, reopenTaskAction, startTaskAction } from '@/app/(app)/tasks/actions'
import { useCall } from '@/components/meds/shared'

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
export function TaskTable({ rows, staff, canManage, canComplete, meId, emptyText }: {
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
  const [menu, setMenuState] = useState<{ id: string; top: number; right: number } | null>(null)
  const openMenu = (id: string, el: HTMLElement) => {
    if (menu?.id === id) return setMenuState(null)
    const b = el.getBoundingClientRect()
    setMenuState({ id, top: b.bottom + 4, right: Math.max(8, window.innerWidth - b.right) })
  }
  const setMenu = (v: null) => setMenuState(v)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-menu]')) setMenuState(null) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuState(null)
    const off = () => setMenuState(null)
    document.addEventListener('click', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', off)
    document.addEventListener('scroll', off, true)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', off); document.removeEventListener('scroll', off, true) }
  }, [menu])

  const done = (row: TaskRowDto) => row.view === 'done' || row.view === 'partial' || row.view === 'skipped'
  const quick = (row: TaskRowDto) => {
    if (!canComplete || pending) return
    if (done(row)) return call(reopenTaskAction, { id: row.id })
    call(completeTaskAction, { id: row.id, status: 'done' }, () => {
      toast(t('tasks.toast.done', { title: row.title }), { undo: () => call(reopenTaskAction, { id: row.id }), undoLabel: t('common.undo') })
    }, true)
  }

  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>{emptyText}</p>

  return (
    <>
      <div className="tablewrap">
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
              return (
                <tr key={row.id} className={row.view === 'over' ? 'over' : ''}>
                  <td className="mono nowrap">
                    {row.time}
                    {row.day && <div className="small muted">{row.day}</div>}
                    {row.view === 'over' && <div className="small">{t('tasks.view.over')}</div>}
                    {row.view === 'due' && <div className="small warn-text">{t('tasks.view.due')}</div>}
                  </td>
                  <td>
                    {row.resident ? (
                      <>
                        <Link className="linkbtn" href={`/residents/${row.resident.id}`}>{row.resident.name}</Link>
                        {row.resident.room && <div className="small muted mono">{t('meds.roomShort', { room: row.resident.room })}</div>}
                      </>
                    ) : <span className="muted">{t('tasks.noResident')}</span>}
                  </td>
                  <td style={closed ? { color: 'var(--fg-3)' } : undefined}>
                    <span style={row.view === 'done' ? { textDecoration: 'line-through', textDecorationColor: 'var(--line-strong)' } : undefined}>{row.title}</span>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      <span className="small muted">{t('tasks.minutes', { n: row.durationMin })}</span>
                      {row.priority !== 'routine' && <span className={'tag ' + (row.priority === 'critical' ? 'crit' : 'warn')}>{t('common.priority.' + row.priority)}</span>}
                      {row.view === 'in_progress' && <span className="tag accent">{t('tasks.view.in_progress')}</span>}
                      {row.view === 'escalated' && <span className="tag crit">{t('tasks.view.escalated')}</span>}
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
                  <td className="right nowrap">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap', position: 'relative' }} data-menu>
                      <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={menu?.id === row.id} aria-label={t('tasks.actions.menuFor', { title: row.title })} onClick={(e) => openMenu(row.id, e.currentTarget)}>⋯</button>
                      {menu?.id === row.id && (
                        <div className="popover" role="menu" style={{ position: 'fixed', width: 230, top: menu.top, right: menu.right, textAlign: 'left' }}>
                          <ul className="menu">
                            {!closed && canComplete && row.view !== 'in_progress' && !row.link && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); call(startTaskAction, { id: row.id }) }}>{t('tasks.actions.start')}</button></li>}
                            {!closed && canManage && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); setDlg({ row, mode: 'assign' }) }}>{t('tasks.actions.assign')}</button></li>}
                            {!closed && canComplete && !row.assignee && !canManage && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); call(startTaskAction, { id: row.id }) }}>{t('tasks.actions.takeOver')}</button></li>}
                            {!closed && canComplete && !row.link && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); setDlg({ row, mode: 'partial' }) }}>{t('tasks.actions.partial')}</button></li>}
                            {!closed && canComplete && !row.link && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); setDlg({ row, mode: 'skipped' }) }}>{t('tasks.actions.skip')}</button></li>}
                            {!closed && canComplete && row.view !== 'escalated' && <li><button type="button" role="menuitem" style={{ color: 'var(--crit)' }} onClick={() => { setMenu(null); setDlg({ row, mode: 'escalate' }) }}>{t('tasks.actions.escalate')}</button></li>}
                            {closed && canComplete && !row.link && <li><button type="button" role="menuitem" onClick={() => { setMenu(null); call(reopenTaskAction, { id: row.id }) }}>{t('tasks.actions.reopen')}</button></li>}
                            <li><button type="button" role="menuitem" onClick={() => { setMenu(null); setDlg({ row, mode: 'details' }) }}>{t('tasks.actions.details')}</button></li>
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
              )
            })}
          </tbody>
        </table>
      </div>
      {dlg && <RowDialog key={dlg.row.id + dlg.mode} row={dlg.row} mode={dlg.mode} staff={staff} onClose={() => setDlg(null)} />}
    </>
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
          <label className="fld">
            <span className="lbl">{t('tasks.col.assignee')}</span>
            <select className="field" name="assigneeId" defaultValue={row.assignee?.id ?? ''}>
              <option value="">{t('tasks.unassigned')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.initials})</option>)}
            </select>
          </label>
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
          <label className="fld">
            <span className="lbl">{t('tasks.escalate.reason')}</span>
            <textarea className="field" name="reason" rows={3} required placeholder={t('tasks.escalate.reasonPh')} />
          </label>
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
        <label className="fld">
          <span className="lbl">{t('tasks.complete.reason')}</span>
          <textarea className="field" name="reason" rows={3} required placeholder={t(mode === 'partial' ? 'tasks.complete.partialPh' : 'tasks.complete.skipPh')} />
        </label>
        {foot(t(mode === 'partial' ? 'tasks.actions.partial' : 'tasks.actions.skip'))}
      </ActionForm>
    </Dialog>
  )
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
              <label className="fld span-all">
                <span className="lbl">{t('tasks.create.titleField')}</span>
                <input ref={first} className="field" name="title" required maxLength={200} placeholder={t('tasks.create.titlePh')} />
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.col.resident')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></span>
                <select className="field" name="residentId" defaultValue="">
                  <option value="">{t('tasks.create.noResident')}</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.room ? r.room + ' · ' : ''}{r.name}</option>)}
                </select>
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.col.category')}</span>
                <input className="field" name="category" list="task-cats" defaultValue={categories[0] ?? ''} />
                <datalist id="task-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.create.date')}</span>
                <input className="field" type="date" name="date" defaultValue={todayKey} required />
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.create.time')}</span>
                <input className="field mono" type="time" name="time" defaultValue={defaultTime} required />
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.details.duration')}</span>
                <input className="field mono" name="durationMin" inputMode="numeric" defaultValue="10" />
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.details.priority')}</span>
                <select className="field" name="priority" defaultValue="routine">
                  {(['routine', 'important', 'critical'] as const).map((p) => <option key={p} value={p}>{t('common.priority.' + p)}</option>)}
                </select>
              </label>
              <label className="fld">
                <span className="lbl">{t('tasks.col.assignee')}</span>
                <select className="field" name="assigneeId" defaultValue="">
                  <option value="">{t('tasks.unassigned')}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.id === meId ? t('tasks.me') + ' – ' : ''}{s.name} ({s.initials})</option>)}
                </select>
              </label>
              <label className="fld span-all">
                <span className="lbl">{t('tasks.create.description')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></span>
                <textarea className="field" name="description" rows={3} />
              </label>
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
