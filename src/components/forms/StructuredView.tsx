'use client'

import { useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { structuredRows, type StructuredForm } from '@/lib/forms'
import { acknowledgeObservation } from '@/app/(app)/residents/[id]/notes/form-actions'

/** Formulareintrag im Verlauf als kompakte Definitionsliste (Momentaufnahme der Feldbezeichnungen). */
export function StructuredView({ s }: { s: StructuredForm }) {
  const t = useT()
  const rows = structuredRows(s, { yes: t('common.yes'), no: t('common.no') })
  return (
    <div className="stack-sm" style={{ gap: 4, maxWidth: '72ch' }}>
      <span className="small fg2">{s.formName} <span className="muted mono">v{s.formVersion}</span></span>
      {rows.length ? (
        <dl className="kv">
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'contents' }}>
              <dt>{r.label}</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : <span className="small muted">{t('forms.entry.empty')}</span>}
    </div>
  )
}

export type NoteAckInfo = { done: boolean; at: string | null; count: number; own: boolean }

/** "Zur Kenntnis genommen" für wichtige Verlaufseinträge (Einstellung residentImportantNoteRequiresAck). */
export function NoteAck({ residentId, id, ack }: { residentId: string; id: string; ack: NoteAckInfo }) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <div className="row" style={{ gap: 8, marginTop: 6 }}>
      {ack.own ? null : ack.done ? (
        <span className="tag ok">✓ {t('forms.ack.acked', { time: ack.at ?? '' })}</span>
      ) : (
        <button
          type="button"
          className="btn sm primary"
          data-loading={pending || undefined}
          disabled={pending}
          onClick={() => start(async () => {
            const r = await acknowledgeObservation(residentId, id)
            if (r.ok) toast(t(r.message ?? 'forms.ack.done'))
            else toast(t(r.error), { kind: 'crit' })
          })}
        >
          {t('forms.ack.button')}
        </button>
      )}
      <span className="small muted">{t('forms.ack.count', { n: ack.count })}</span>
    </div>
  )
}
