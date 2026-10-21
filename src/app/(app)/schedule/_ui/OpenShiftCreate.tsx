'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { IconPlus } from '@/components/icons'
import { ShiftDialog, type ShiftDraft, type ShiftType, type StaffOpt } from './ShiftDialog'

/** Leitung: offenen Dienst mit erforderlicher Qualifikation ausschreiben. */
export function OpenShiftCreate({ unitId, types, staff, quals }: { unitId: string; types: ShiftType[]; staff: StaffOpt[]; quals: string[] }) {
  const t = useT()
  const [draft, setDraft] = useState<ShiftDraft | null>(null)
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return (
    <>
      <button type="button" className="btn" onClick={() => setDraft({ date: key, userId: null, req: quals[0] ?? null })}><IconPlus size={16} />{t('schedule.open.create')}</button>
      <ShiftDialog draft={draft} onClose={() => setDraft(null)} types={types} staff={staff} quals={quals} unitId={unitId} />
    </>
  )
}
