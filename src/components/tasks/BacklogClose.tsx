'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Textarea } from '@/components/ui/fields'
import { useCall } from '@/components/meds/shared'
import { closeBacklogAction } from '@/app/(app)/tasks/actions'

export type BacklogRow = { id: string; when: string; title: string; resident: string | null; room: string | null; escalated: boolean }

/**
 * Rückstand früherer Schichten (PRD §12.3): Sammelabschluss «nicht durchgeführt» mit gemeinsamer Begründung.
 * Jede Aufgabe einzeln abwählbar; Medikamenten-Zeitpunkte sind nicht enthalten (Dokumentation in der Abgabeliste).
 */
export function BacklogClose({ rows, medCount }: { rows: BacklogRow[]; medCount: number }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { pending, call } = useCall()
  const toggle = (id: string) => setSel((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  if (!rows.length) return null
  const submit = () => {
    if (reason.trim().length < 3) return setError(t('tasks.errors.reason'))
    setError(null)
    call(closeBacklogAction, { ids: [...sel].join(','), reason: reason.trim() }, (r) => { if (r.ok) setOpen(false) })
  }
  return (
    <>
      <div className="alert warn" role="status" style={{ alignItems: 'center' }}>
        <span className="grow fg">{t('tasks.backlog.notice', { n: rows.length })}</span>
        <button type="button" className="btn sm" onClick={() => { setSel(new Set(rows.map((r) => r.id))); setOpen(true) }}>{t('tasks.backlog.button')}</button>
      </div>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={t('tasks.backlog.title')}>
          <p className="fg2" style={{ margin: 0 }}>{t('tasks.backlog.hint')}</p>
          <ul className="list card bulk-list">
            {rows.map((r) => (
              <li key={r.id}>
                <Checkbox checked={sel.has(r.id)} onChange={() => toggle(r.id)} wrapClassName="li bulk-item" label={<>
                  <span className="mono small nowrap">{r.when}</span>
                  {r.room && <span className="roomtag">{r.room}</span>}
                  <span className="grow">{r.title}{r.resident ? <span className="muted"> · {r.resident}</span> : null}</span>
                  {r.escalated && <span className="tag crit">{t('tasks.view.escalated')}</span>}
                </>} />
              </li>
            ))}
          </ul>
          {medCount > 0 && <p className="small muted" style={{ margin: 0 }}>{t('tasks.backlog.meds', { n: medCount })}</p>}
          <Textarea label={t('tasks.complete.reason')} name="reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('tasks.backlog.reasonPh')} error={error ?? undefined} />
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn primary" disabled={pending || !sel.size} data-loading={pending || undefined} onClick={submit}>{t('tasks.backlog.confirm', { n: sel.size })}</button>
          </div>
        </Dialog>
      )}
    </>
  )
}
