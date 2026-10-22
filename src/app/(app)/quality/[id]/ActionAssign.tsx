'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Combobox } from '@/components/ui/fields'
import { assignIncidentActionAction } from '../actions'

export type StaffOpt = { id: string; name: string; initials: string }

/** Assign (PRD §49) für eine Ereignis-Massnahme – gleiche Bedienung wie bei Aufgaben. */
export function ActionAssign({ id, title, assigneeId, staff, context }: { id: string; title: string; assigneeId: string | null; staff: StaffOpt[]; context: React.ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)} aria-label={t('quality.detail.assignFor', { title })}>{t('tasks.actions.assign')}</button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={t('quality.detail.assignTitle')} context={context}>
          <ActionForm action={assignIncidentActionAction.bind(null, id)} onDone={(r) => r.ok && setOpen(false)}>
            <p style={{ margin: 0 }}><strong style={{ fontWeight: 500 }}>{title}</strong></p>
            <Combobox label={t('tasks.col.assignee')} name="assigneeId" defaultValue={assigneeId ?? ''} placeholder={t('tasks.unassigned')}
              options={staff.map((s) => ({ value: s.id, label: s.name, hint: s.initials, keywords: s.initials }))} />
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
              <Submit>{t('tasks.actions.assignSave')}</Submit>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Auswahl der zuständigen Person beim Erfassen einer Massnahme. */
export function AssigneeField({ staff }: { staff: StaffOpt[] }) {
  const t = useT()
  return (
    <Combobox label={t('tasks.col.assignee')} optional name="assigneeId" defaultValue="" placeholder={t('tasks.unassigned')}
      options={staff.map((s) => ({ value: s.id, label: s.name, hint: s.initials, keywords: s.initials }))} />
  )
}
