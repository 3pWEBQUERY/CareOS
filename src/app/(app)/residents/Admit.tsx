'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconPlus } from '@/components/icons'
import { ResidentFields } from './_components/ResidentFields'
import { admitResident } from './actions'

export function Admit({ rooms, unitName }: { rooms: { id: string; label: string }[]; unitName: string }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}><IconPlus size={16} />{t('residents.admit.button')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('residents.admit.title')} wide context={<span>{t('residents.admit.context', { unit: unitName })}</span>}>
        <ActionForm
          action={admitResident}
          success="residents.admit.done"
          onDone={(r) => {
            if (!r.ok) return
            setOpen(false)
            const id = (r.data as { id?: string } | undefined)?.id
            if (id) router.push(`/residents/${id}`)
          }}
        >
          <ResidentFields rooms={rooms} />
          <div className="form-actions">
            <span className="small muted">{t('residents.admit.hint')}</span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" className="btn primary">{t('residents.admit.submit')}</button>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}
