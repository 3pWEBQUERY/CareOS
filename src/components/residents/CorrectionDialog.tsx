'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { SegmentedControl, Textarea } from '@/components/ui/fields'

type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; field?: string }

/** Häufige Begründungen als Vorlage (Text bleibt frei ergänzbar). «Falsche Person» erlaubt nur den Storno. */
const REASONS = ['typo', 'measurement', 'wrongResident', 'duplicate'] as const

/**
 * Storno oder Korrektur einer klinischen Messung (PRD §35): der ursprüngliche Eintrag bleibt sichtbar (durchgestrichen)
 * und im Audit-Protokoll; die Begründung ist Pflicht. «Korrigieren» speichert die Felder aus `fields` als neuen Eintrag
 * mit demselben Messzeitpunkt, «Stornieren» markiert den Eintrag nur als ungültig.
 */
export function CorrectionDialog({ open, onClose, title, who, original, fields, action, onDone, canReplace = true }: {
  open: boolean
  onClose: () => void
  title: string
  /** Person und Zimmer (Kontext bei kritischen Aktionen, PRD §32) */
  who: string
  /** Zusammenfassung des ursprünglichen Eintrags */
  original: React.ReactNode
  /** Eingabefelder der Korrektur (vorbelegt mit den ursprünglichen Werten) */
  fields?: React.ReactNode
  action: (form: FormData) => Promise<Result>
  onDone?: (r: Result) => void
  canReplace?: boolean
}) {
  const t = useT()
  const [mode, setMode] = useState<'correct' | 'void'>(canReplace ? 'correct' : 'void')
  const [reason, setReason] = useState('')
  const [wrongPerson, setWrongPerson] = useState(false)
  const effective = wrongPerson || !canReplace ? 'void' : mode
  const pick = (k: (typeof REASONS)[number]) => {
    const text = t('chart.void.reasons.' + k)
    setReason((cur) => (cur.trim() ? cur.trim() + '; ' + text : text))
    if (k === 'wrongResident') setWrongPerson(true)
  }
  const close = () => { onClose(); setReason(''); setWrongPerson(false); setMode(canReplace ? 'correct' : 'void') }
  return (
    <Dialog open={open} onClose={close} title={title} wide={!!fields && effective === 'correct'} context={<strong>{who}</strong>}>
      <ActionForm
        action={action}
        className="form corr-form"
        reset={false}
        onDone={(r) => { onDone?.(r); if (r.ok) close() }}
      >
        <div className="corr-orig" aria-label={t('chart.void.original')}>
          <span className="lbl">{t('chart.void.original')}</span>
          <div className="corr-orig-body">{original}</div>
        </div>
        {canReplace && (
          <SegmentedControl
            label={t('chart.void.mode')}
            name="mode"
            value={effective}
            onChange={(v) => setMode(v as 'correct' | 'void')}
            options={[
              { value: 'correct', label: t('chart.void.modeCorrect'), disabled: wrongPerson },
              { value: 'void', label: t('chart.void.modeVoid') },
            ]}
            hint={effective === 'correct' ? t('chart.void.correctHint') : t(wrongPerson ? 'chart.void.wrongPersonHint' : 'chart.void.voidHint')}
          />
        )}
        {!canReplace && <input type="hidden" name="mode" value="void" />}
        {!canReplace && <p className="small muted" style={{ margin: 0 }}>{t(wrongPerson ? 'chart.void.wrongPersonHint' : 'chart.void.voidHint')}</p>}
        {fields && effective === 'correct' && <div className="corr-fields">{fields}</div>}
        <div className="stack-sm" style={{ gap: 6 }}>
          <Textarea
            label={t('chart.void.reason')}
            name="reason"
            required
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => { setReason(e.target.value); if (!e.target.value.trim()) setWrongPerson(false) }}
            hint={t('chart.void.reasonHint')}
          />
          <div className="chips" role="group" aria-label={t('chart.void.reasonPicks')}>
            {REASONS.map((k) => (
              <button key={k} type="button" className="chip" onClick={() => pick(k)}>{t('chart.void.reasons.' + k)}</button>
            ))}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('chart.void.auditHint')}</p>
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
          {effective === 'correct'
            ? <button type="submit" className="btn primary">{t('chart.void.saveCorrect')}</button>
            : <button type="submit" className="btn danger solid">{t('chart.void.saveVoid')}</button>}
        </div>
      </ActionForm>
    </Dialog>
  )
}

/** Tag und Begründung eines stornierten Eintrags in Listen und Historie (Status nie nur über Durchstreichen). */
export function VoidedNote({ tag, detail }: { tag: string; detail: string }) {
  return (
    <span className="voided-note small">
      <span className="tag outline">{tag}</span> <span className="muted">{detail}</span>
    </span>
  )
}
