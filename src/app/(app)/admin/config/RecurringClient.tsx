'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { SeriesToggle, TemplateDialog, type SeriesPerson, type SeriesStaff } from '@/components/tasks/Recurrence'
import type { TemplateDto } from '@/lib/recurrence'

type Common = { units: { id: string; name: string }[]; residents: SeriesPerson[]; staff: Record<string, SeriesStaff[]>; categories: string[]; todayKey: string }

export function RecurringAdd(p: Common) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('tasks.recur.admin.add')}</button>
      {open && <TemplateDialog {...p} onClose={() => setOpen(false)} />}
    </>
  )
}

export function RecurringRow({ template, ...p }: Common & { template: TemplateDto }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      {template.active && <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}>{t('common.edit')}</button>}
      <SeriesToggle id={template.id} active={template.active} title={template.title} />
      {open && <TemplateDialog {...p} template={template} onClose={() => setOpen(false)} />}
    </>
  )
}
