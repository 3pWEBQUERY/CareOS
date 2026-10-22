'use client'

import { useState } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { CorrectionDialog } from '@/components/residents/CorrectionDialog'
import { NumberField, TextField } from '@/components/ui/fields'
import { correctVitals } from './actions'

type Field = { key: string; label: string; unit: string; dec: number }

/** «Korrigieren» an einer Messung: Werte vorbelegt, Begründung Pflicht (PRD §35). */
export function VitalCorrect({ residentId, vitalId, who, when, values, note, fields }: {
  residentId: string
  vitalId: string
  who: string
  /** Messzeitpunkt, z. B. «Heute 08:25» */
  when: string
  values: Record<string, number | null>
  note: string | null
  fields: Field[]
}) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const nf = (v: number, dec: number) => new Intl.NumberFormat(INTL_LOCALE[locale], { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false }).format(v)
  const shown = fields.filter((f) => values[f.key] != null)
  const summary = shown.map((f) => `${f.label} ${nf(values[f.key]!, f.dec)} ${f.unit}`).join(' · ')
  return (
    <>
      <button type="button" className="linkbtn small" onClick={() => setOpen(true)} aria-label={`${t('chart.void.action')}: ${when}`}>{t('chart.void.action')}</button>
      {open && (
        <CorrectionDialog
          open
          onClose={() => setOpen(false)}
          title={t('chart.void.titleVitals')}
          who={who}
          original={<><span className="mono">{when} · {summary}</span>{note ? <div className="small muted">{note}</div> : null}</>}
          action={(f) => correctVitals(residentId, vitalId, f)}
          fields={
            <div className="vform corr-vform">
              {fields.map((f) => (
                <NumberField
                  key={f.key} name={f.key} label={f.label} unit={f.unit}
                  defaultValue={values[f.key] ?? ''}
                />
              ))}
              <TextField label={t('chart.vitals.note')} name="note" defaultValue={note ?? ''} maxLength={500} wrapStyle={{ gridColumn: '1 / -1' }} />
            </div>
          }
        />
      )}
    </>
  )
}
