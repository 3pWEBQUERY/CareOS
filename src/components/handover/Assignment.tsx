'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { isKey } from '@/components/meds/shared'
import { saveAssignmentsAction } from '@/app/(app)/_home/actions'

type Pair = { residentId: string; userId: string }
export type AssignmentBoardDto = {
  shift: { code: string; date: string; name: string; start: string; end: string }
  residents: { id: string; name: string; room: string | null }[]
  staff: { id: string; initials: string; name: string; onDuty: boolean }[]
  pairs: Pair[]
  suggestion: Pair[]
}

const keyOf = (p: Pair) => p.residentId + ':' + p.userId

function useSave() {
  const t = useT()
  const [pending, start] = useTransition()
  const save = (board: AssignmentBoardDto, pairs: Pair[], opts: { onOk?: () => void; undo?: Pair[] } = {}) =>
    start(async () => {
      const f = new FormData()
      f.set('shiftCode', board.shift.code)
      f.set('date', board.shift.date)
      f.set('pairs', JSON.stringify(pairs))
      try {
        const r = await saveAssignmentsAction(f)
        if (!r.ok) {
          toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit', ms: 6000 })
          return
        }
        opts.onOk?.()
        const undo = opts.undo
        if (r.message) toast(isKey(r.message) ? t(r.message) : r.message, undo ? { undo: () => save(board, undo) } : {})
      } catch {
        toast(t('common.genericError'), { kind: 'crit', ms: 6000 })
      }
    })
  return { pending, save }
}

/**
 * Zuteilung der Schicht (PRD §7, §70): je Person ein oder mehrere Mitarbeitende im Dienst.
 * Vorschlag aus der letzten Schicht (Kontinuität), sonst Bezugsperson, sonst gleichmässig verteilt.
 */
export function AssignmentButton({ board, label, className = 'btn' }: { board: AssignmentBoardDto; label?: string; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Speichern lebt hier (nicht im Dialog), damit «Rückgängig» auch nach dem Schliessen wirkt
  const saver = useSave()
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} disabled={saver.pending} data-loading={(saver.pending && !open) || undefined}>{label ?? t('home.assign.edit')}</button>
      {open && <AssignmentDialog board={board} saver={saver} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Vorschlag mit einem Klick übernehmen (Rückgängig im Hinweis). */
export function AcceptSuggestion({ board }: { board: AssignmentBoardDto }) {
  const t = useT()
  const { pending, save } = useSave()
  return (
    <button type="button" className="btn primary" disabled={pending || !board.suggestion.length} data-loading={pending || undefined}
      onClick={() => save(board, board.suggestion, { undo: board.pairs })}>
      {t('home.assign.accept')}
    </button>
  )
}

function AssignmentDialog({ board, saver, onClose }: { board: AssignmentBoardDto; saver: ReturnType<typeof useSave>; onClose: () => void }) {
  const t = useT()
  const { pending, save } = saver
  const [sel, setSel] = useState<Set<string>>(() => new Set(board.pairs.map(keyOf)))
  const pairs = useMemo(() => [...sel].map((k) => { const [residentId, userId] = k.split(':'); return { residentId, userId } }), [sel])
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const load = (uid: string) => pairs.filter((p) => p.userId === uid).length
  const unassigned = board.residents.filter((r) => !pairs.some((p) => p.residentId === r.id)).length
  const dirty = sel.size !== board.pairs.length || board.pairs.some((p) => !sel.has(keyOf(p)))
  const suggestionApplied = board.suggestion.length === sel.size && board.suggestion.every((p) => sel.has(keyOf(p)))
  return (
    <Dialog open onClose={onClose} wide title={t('home.assign.title', { shift: board.shift.name })}
      context={<span className="mono">{board.shift.date.split('-').reverse().join('.')} · {board.shift.start}–{board.shift.end}</span>}
      footer={
        <>
          <span className="small muted grow" aria-live="polite">
            {board.staff.filter((s) => s.onDuty || load(s.id)).map((s) => `${s.initials} ${load(s.id)}`).join(' · ')}
            {unassigned > 0 && <> · <span className="warn-text">{t('home.assign.unassigned', { n: unassigned })}</span></>}
          </span>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn primary" disabled={pending || !dirty} data-loading={pending || undefined}
            onClick={() => save(board, pairs, { onOk: onClose, undo: board.pairs })}>{t('common.save')}</button>
        </>
      }>
      {board.staff.length ? (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm" disabled={!board.suggestion.length || suggestionApplied} onClick={() => setSel(new Set(board.suggestion.map(keyOf)))}>{t('home.assign.useSuggestion')}</button>
            <button type="button" className="btn sm ghost" disabled={!sel.size} onClick={() => setSel(new Set())}>{t('home.assign.clear')}</button>
            <span className="small muted">{t('home.assign.hint')}</span>
          </div>
          <ul className="list card asg-list">
            {board.residents.map((r) => (
              <li key={r.id} className="li asg-row">
                <span className="roomtag">{r.room ?? '–'}</span>
                <span className="grow asg-name">{r.name}</span>
                <span className="chips asg-staff" role="group" aria-label={r.name}>
                  {board.staff.map((s) => {
                    const k = r.id + ':' + s.id
                    return (
                      <button key={s.id} type="button" className={'chip asg-chip' + (s.onDuty ? '' : ' off')} aria-pressed={sel.has(k)} onClick={() => toggle(k)}
                        title={s.onDuty ? s.name : `${s.name} · ${t('home.assign.notOnDuty')}`} aria-label={`${s.name} – ${r.name}`}>
                        {s.initials}
                      </button>
                    )
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>{board.staff.map((s) => `${s.initials} = ${s.name}${s.onDuty ? '' : ' (' + t('home.assign.notOnDuty') + ')'}`).join(' · ')}</p>
        </>
      ) : (
        <div className="empty">
          <strong>{t('home.assign.noStaff')}</strong>
          <Link className="btn sm" href="/schedule">{t('nav.schedule')}</Link>
        </div>
      )}
    </Dialog>
  )
}
