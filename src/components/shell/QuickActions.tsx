'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { IconPlus } from '@/components/icons'

/** Zentraler Action Button für Mobile (PRD §28), Einhandbedienung. */
export function QuickActions({ canIncident, canTask }: { canIncident: boolean; canTask: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="fab" aria-label={t('common.quick.label')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconPlus size={24} />
      </button>
      {open && (
        <>
          <div className="scrim" style={{ alignItems: 'flex-end', padding: 0 }} onClick={() => setOpen(false)} />
          <div className="sheet" role="menu" onClick={() => setOpen(false)}>
            <span className="lbl">{t('common.quick.label')}</span>
            <Link className="btn lg" href="/residents?pick=notes" role="menuitem">{t('common.quick.document')}</Link>
            <Link className="btn lg" href="/residents?pick=vitals" role="menuitem">{t('common.quick.vitals')}</Link>
            {canTask && <Link className="btn lg" href="/tasks?new=1" role="menuitem">{t('common.quick.task')}</Link>}
            {canIncident && <Link className="btn lg" href="/quality/new" role="menuitem">{t('common.quick.incident')}</Link>}
          </div>
        </>
      )}
    </>
  )
}
