'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { ResidentFields, type ResidentDefaults } from '../../_components/ResidentFields'
import { updateResident } from '../../actions'

export function EditMaster({ residentId, d, rooms, nurses }: { residentId: string; d: ResidentDefaults; rooms: { id: string; label: string }[]; nurses: { id: string; label: string }[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('residents.history.edit')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('residents.history.edit')} wide context={<span>{d.lastName} {d.firstName}</span>}>
        <ActionForm action={updateResident.bind(null, residentId)} success="common.saved" reset={false} onDone={(r) => r.ok && setOpen(false)}>
          <ResidentFields d={d} rooms={rooms} nurses={nurses} edit />
          <div className="form-actions">
            <span className="small muted">{t('residents.history.editHint')}</span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn primary">{t('common.save')}</button>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}
