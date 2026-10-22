'use client'

import { useId, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/toast'
import { askVisitQuestion, withdrawVisitQuestion } from '@/app/(app)/tasks/visit/actions'
import type { VisitRefOptionDto } from './types'
import { Select, Textarea } from '@/components/ui/fields'

/**
 * Vorbereiten (PRD §29): Frage für die nächste Visite vormerken. Bezug optional auf einen auffälligen Vitalwert
 * oder Verlaufseintrag der letzten 7 Tage; der Dialog zeigt die Person als Kontext (PRD §32).
 */
export function AskQuestion({ residentId, who, options, initialRef = '', refOption, className = 'btn sm', label, onAsked }: {
  residentId: string
  who: string
  options: VisitRefOptionDto[]
  initialRef?: string
  /** Bezug direkt an einer Zeile (Verlauf, Vitalwert): vorausgewählt, auch wenn er älter als 7 Tage ist. */
  refOption?: VisitRefOptionDto
  className?: string
  label?: string
  onAsked?: (ref: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const start = refOption?.value ?? initialRef
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label ?? t('visit.ask.button')}</button>
      <AskQuestionDialog open={open} onClose={() => setOpen(false)} residentId={residentId} who={who} options={options} initialRef={start} refOption={refOption} onAsked={onAsked} />
    </>
  )
}

/** Gesteuerter Dialog «Frage für die Visite» – für Listen mit einer Aktion je Zeile (ein Dialog für alle Zeilen). */
export function AskQuestionDialog({ open, onClose, residentId, who, options, initialRef = '', refOption, onAsked }: {
  open: boolean
  onClose: () => void
  residentId: string
  who: string
  options: VisitRefOptionDto[]
  initialRef?: string
  refOption?: VisitRefOptionDto
  onAsked?: (ref: string) => void
}) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState('')
  const [ref, setRef] = useState(initialRef)
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [pending, start] = useTransition()
  // Beim Öffnen den Bezug der auslösenden Zeile übernehmen
  const [seen, setSeen] = useState<string | null>(null)
  const openKey = open ? 'open:' + initialRef : null
  if (openKey !== seen) { setSeen(openKey); if (openKey) { setRef(initialRef); setErr(null) } }
  const close = () => { if (!pending) { onClose(); setErr(null) } }
  const submit = () => start(async () => {
    if (text.trim().length < 3) return setErr({ msg: t('visit.errors.text'), field: 'text' })
    const r = await askVisitQuestion(residentId, { text, ref })
    if (!r.ok) return setErr({ msg: t(r.error), field: r.field })
    toast(r.message ?? t('visit.toast.asked'))
    onAsked?.(ref)
    setText('')
    setRef(initialRef)
    setErr(null)
    onClose()
  })
  const all = refOption && !options.some((o) => o.value === refOption.value) ? [refOption, ...options] : options
  const vitals = all.filter((o) => o.group === 'vital')
  const notes = all.filter((o) => o.group === 'observation')
  return (
    <Dialog
        open={open}
        onClose={close}
        title={t('visit.ask.title')}
        context={<span>{who}</span>}
        footer={<>
          <button type="button" className="btn" onClick={close} disabled={pending}>{t('common.cancel')}</button>
          <button type="button" className="btn primary" onClick={submit} disabled={pending} data-loading={pending || undefined}>{t('visit.ask.save')}</button>
        </>}
      >
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <Textarea label={t('visit.ask.text')} id={id + 'q'} rows={3} value={text} autoFocus maxLength={1000} counter placeholder={t('visit.ask.textPh')}
            error={err?.field === 'text' ? err.msg : undefined}
            onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
          {all.length > 0 && (
            <Select label={t('visit.ask.ref')} optional id={id + 'r'} value={ref} onChange={(e) => setRef(e.target.value)} aria-invalid={err?.field === 'ref' || undefined}>
                <option value="">{t('visit.ask.refNone')}</option>
                {vitals.length > 0 && <optgroup label={t('visit.ask.refVital')}>{vitals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
                {notes.length > 0 && <optgroup label={t('visit.ask.refNote')}>{notes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
              </Select>
          )}
          {err && err.field !== 'text' && <p className="err" role="alert" style={{ margin: 0 }}>{err.msg}</p>}
        </form>
      </Dialog>
  )
}

/** Frage zurückziehen, mit Bestätigung (die Frage verschwindet aus der Visite). */
export function WithdrawQuestion({ residentId, questionId, text, who }: { residentId: string; questionId: string; text: string; who: string }) {
  const t = useT()
  const [ask, dialog] = useConfirm()
  const [pending, start] = useTransition()
  const go = async () => {
    if (!(await ask({ ...splitQuestion(t('visit.card.withdrawConfirm')), context: <span>{who} · {text}</span>, confirmLabel: t('visit.card.withdraw') }))) return
    start(async () => {
      const r = await withdrawVisitQuestion(residentId, questionId)
      toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? {} : { kind: 'crit' })
    })
  }
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={go} disabled={pending} data-loading={pending || undefined}>{t('visit.card.withdraw')}</button>
      {dialog}
    </>
  )
}

