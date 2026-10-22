'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { requestSwapAction } from '../actions'
import { Select, Textarea } from '@/components/ui/fields'

/** Tausch für einen eigenen Dienst anfragen – optional gezielt an eine Kollegin / einen Kollegen. */
export function SwapButton({ shiftId, label, colleagues }: { shiftId: string; label: string; colleagues: { id: string; name: string; qual: string; busy: boolean }[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('schedule.swap.request')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('schedule.swap.request')} context={<span>{label}</span>}>
        <ActionForm action={requestSwapAction} success="schedule.swap.saved" onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name="shiftId" value={shiftId} />
          <Select label={t('schedule.swap.with')} hint={t('schedule.swap.withHint')} name="takerId" defaultValue="">
              <option value="">{t('schedule.swap.anyone')}</option>
              {colleagues.map((c) => <option key={c.id} value={c.id} disabled={c.busy}>{c.name}{c.qual ? ` · ${c.qual}` : ''}{c.busy ? ` · ${t('schedule.swap.busy')}` : ''}</option>)}
            </Select>
          <Textarea label={t('schedule.swap.note')} optional name="note" rows={2} maxLength={500} style={{ minHeight: 60 }} />
          <div className="form-actions">
            <Submit>{t('schedule.swap.submit')}</Submit>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}
