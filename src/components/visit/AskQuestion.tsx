'use client'

import { useId, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/toast'
import { askVisitQuestion, withdrawVisitQuestion } from '@/app/(app)/tasks/visit/actions'
import type { VisitRefOptionDto } from './types'

/**
 * Vorbereiten (PRD §29): Frage für die nächste Visite vormerken. Bezug optional auf einen auffälligen Vitalwert
 * oder Verlaufseintrag der letzten 7 Tage; der Dialog zeigt die Person als Kontext (PRD §32).
 */
export function AskQuestion({ residentId, who, options, initialRef = '', className = 'btn sm', label }: {
  residentId: string
  who: string
  options: VisitRefOptionDto[]
  initialRef?: string
  className?: string
  label?: string
}) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [ref, setRef] = useState(initialRef)
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [pending, start] = useTransition()
  const close = () => { if (!pending) { setOpen(false); setErr(null) } }
  const submit = () => start(async () => {
    if (text.trim().length < 3) return setErr({ msg: t('visit.errors.text'), field: 'text' })
    const r = await askVisitQuestion(residentId, { text, ref })
    if (!r.ok) return setErr({ msg: t(r.error), field: r.field })
    toast(r.message ?? t('visit.toast.asked'))
    setText('')
    setRef(initialRef)
    setErr(null)
    setOpen(false)
  })
  const vitals = options.filter((o) => o.group === 'vital')
  const notes = options.filter((o) => o.group === 'observation')
  return (
    <>
      <button type="button" className={className} onClick={() => { setRef(initialRef); setOpen(true) }}>{label ?? t('visit.ask.button')}</button>
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
          <label className="fld" htmlFor={id + 'q'}>
            <span className="lbl">{t('visit.ask.text')}</span>
            <textarea id={id + 'q'} className="field" rows={3} value={text} autoFocus maxLength={1000} placeholder={t('visit.ask.textPh')}
              aria-invalid={err?.field === 'text' || undefined} aria-describedby={err?.field === 'text' ? id + 'e' : undefined}
              onChange={(e) => { setText(e.target.value); if (err) setErr(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
            {err?.field === 'text' && <span className="err" id={id + 'e'} role="alert">{err.msg}</span>}
          </label>
          {options.length > 0 && (
            <label className="fld" htmlFor={id + 'r'}>
              <span className="lbl">{t('visit.ask.ref')} <span style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></span>
              <select id={id + 'r'} className="field" value={ref} onChange={(e) => setRef(e.target.value)} aria-invalid={err?.field === 'ref' || undefined}>
                <option value="">{t('visit.ask.refNone')}</option>
                {vitals.length > 0 && <optgroup label={t('visit.ask.refVital')}>{vitals.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
                {notes.length > 0 && <optgroup label={t('visit.ask.refNote')}>{notes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>}
              </select>
            </label>
          )}
          {err && err.field !== 'text' && <p className="err" role="alert" style={{ margin: 0 }}>{err.msg}</p>}
        </form>
      </Dialog>
    </>
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

