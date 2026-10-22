'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { shiftName } from '@/lib/shift-name'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { deleteShiftAction, saveShiftAction } from '../actions'
import { ActButton } from '../../team/_ui/ActButton'
import { DateField } from '@/components/ui/DateField'

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
            <label className="fld">
              <span className="lbl">{t('schedule.plan.date')}</span>
              <DateField name="date" defaultValue={d.date} required />
            </label>
            <label className="fld">
              <span className="lbl">{t('schedule.plan.type')}</span>
              <select name="shiftTypeId" className="field" defaultValue={d.typeId ?? types[0]?.id}>
                {types.map((x) => <option key={x.id} value={x.id}>{x.code} · {shiftName(t, x)} {x.start}–{x.end}</option>)}
              </select>
            </label>
            <label className="fld span-all">
              <span className="lbl">{t('schedule.plan.person')}</span>
              <select name="userId" className="field" defaultValue={d.userId ?? ''} onChange={(e) => setPerson(e.target.value)}>
                <option value="">{t('schedule.plan.openShift')}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.qual ? ` · ${s.qual}` : ''}</option>)}
              </select>
            </label>
            {person === '' ? (
              <label className="fld span-all">
                <span className="lbl">{t('schedule.plan.reqQual')}</span>
                <select name="requiredQualification" className="field" defaultValue={d.req ?? ''}>
                  <option value="">{t('schedule.plan.noReq')}</option>
                  {quals.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
              </label>
            ) : (
              <input type="hidden" name="requiredQualification" value={d.req ?? ''} />
            )}
            <label className="fld span-all">
              <span className="lbl">{t('schedule.plan.note')} <span className="muted">({t('common.optional')})</span></span>
              <input name="note" className="field" defaultValue={d.note ?? ''} maxLength={500} />
            </label>
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
