'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { shiftName } from '@/lib/shift-name'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { deleteShiftAction, saveShiftAction } from '../actions'
import { ActButton } from '../../team/_ui/ActButton'
import { Combobox, DateField, Select, TextField } from '@/components/ui/fields'

export type ShiftType = { id: string; code: string; name: string; start: string; end: string }
export type StaffOpt = { id: string; name: string; qual: string }
export type ShiftDraft = { id?: string; typeId?: string; userId?: string | null; date: string; req?: string | null; note?: string | null }

/** Dienst planen oder bearbeiten (Leitung). Leere Person = offener Dienst. */
export function ShiftDialog({ draft, onClose, types, staff, quals, unitId }: {
  draft: ShiftDraft | null
  onClose: () => void
  types: ShiftType[]
  staff: StaffOpt[]
  quals: string[]
  unitId: string
}) {
  const t = useT()
  return (
    <Dialog open={!!draft} onClose={onClose} title={t(draft?.id ? 'schedule.plan.editTitle' : 'schedule.plan.addTitle')}>
      {draft && <ShiftForm key={draft.id ?? draft.date + (draft.userId ?? '')} d={draft} onClose={onClose} types={types} staff={staff} quals={quals} unitId={unitId} />}
    </Dialog>
  )
}

function ShiftForm({ d, onClose, types, staff, quals, unitId }: { d: ShiftDraft; onClose: () => void; types: ShiftType[]; staff: StaffOpt[]; quals: string[]; unitId: string }) {
  const t = useT()
  const [person, setPerson] = useState<string>(d.userId ?? '')
  return (
        <ActionForm action={saveShiftAction} success="schedule.plan.saved" onDone={(r) => r.ok && onClose()} reset={false}>
          <input type="hidden" name="id" value={d.id ?? ''} />
          <input type="hidden" name="unitId" value={unitId} />
          <div className="form-grid">
            <DateField label={t('schedule.plan.date')} name="date" defaultValue={d.date} required />
            <Select label={t('schedule.plan.type')} name="shiftTypeId" defaultValue={d.typeId ?? types[0]?.id}>
                {types.map((x) => <option key={x.id} value={x.id}>{x.code} · {shiftName(t, x)} {x.start}–{x.end}</option>)}
              </Select>
            <Combobox label={t('schedule.plan.person')} wrapClassName="span-all" name="userId" defaultValue={d.userId ?? ''} onChange={(v) => setPerson(v)} placeholder={t('schedule.plan.openShift')}
              options={staff.map((s) => ({ value: s.id, label: s.name, hint: s.qual || undefined }))} />
            {person === '' ? (
              <Select label={t('schedule.plan.reqQual')} wrapClassName="span-all" name="requiredQualification" defaultValue={d.req ?? ''}>
                  <option value="">{t('schedule.plan.noReq')}</option>
                  {quals.map((q) => <option key={q} value={q}>{q}</option>)}
                </Select>
            ) : (
              <input type="hidden" name="requiredQualification" value={d.req ?? ''} />
            )}
            <TextField label={t('schedule.plan.note')} optional wrapClassName="span-all" name="note" defaultValue={d.note ?? ''} maxLength={500} />
          </div>
          <div className="form-actions">
            <Submit>{t('common.save')}</Submit>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
            <span className="spacer" />
            {d.id && (
              <ActButton action={async () => { const r = await deleteShiftAction(d.id!); if (r.ok) onClose(); return r }} className="btn danger" confirm="schedule.plan.deleteConfirm" success="schedule.plan.deleted">
                {t('common.delete')}
              </ActButton>
            )}
          </div>
        </ActionForm>
  )
}
