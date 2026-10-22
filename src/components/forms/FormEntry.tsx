'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { validateFormValues, type FieldError, type FormField } from '@/lib/forms'
import { createFormEntry } from '@/app/(app)/residents/[id]/notes/form-actions'
import { FormFields, type RawValues } from './FormFields'

export type FormOption = { id: string; name: string; description: string | null; version: number; fields: FormField[] }

/**
 * Knopf "Formular" neben dem Verlaufseintrag (PRD §10.3 Fokusdokumentation).
 * Der Dialog wird in den <body> portiert, damit er nicht im Formular des Verlaufs liegt
 * (Enter in einem Feld würde sonst den Freitext-Eintrag absenden).
 */
export function FormEntry({ residentId, who, forms }: { residentId: string; who: string; forms: FormOption[] }) {
  const t = useT()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [formId, setFormId] = useState(forms[0]?.id ?? '')
  const [values, setValues] = useState<RawValues>({})
  const [errors, setErrors] = useState<Record<string, FieldError>>({})
  const [important, setImportant] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  useEffect(() => setMounted(true), [])
  if (!forms.length) return null
  const form = forms.find((f) => f.id === formId) ?? forms[0]

  const reset = (id = formId) => { setFormId(id); setValues({}); setErrors({}); setErr(null); setImportant(false) }
  const close = () => { setOpen(false); reset() }

  const save = () => {
    const v = validateFormValues(form.fields, values)
    setErrors(v.errors)
    if (!v.ok) {
      setErr(t('forms.errors.invalid'))
      requestAnimationFrame(() => (document.querySelector('dialog.dlg [aria-invalid="true"] input, dialog.dlg [aria-invalid="true"]') as HTMLElement | null)?.focus())
      return
    }
    setErr(null)
    start(async () => {
      const r = await createFormEntry(residentId, { formId: form.id, version: form.version, values, important })
      if (!r.ok) { setErr(t(r.error)); return }
      toast(t('forms.entry.saved', { name: form.name }))
      close()
    })
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} title={t('forms.entry.hint')}>{t('forms.entry.button')}</button>
      {mounted && open && createPortal(
        <Dialog open={open} onClose={close} wide title={t('forms.entry.title')} context={<span>{who}</span>}
          footer={(
            <>
              <label className="check small" style={{ marginRight: 'auto' }}><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />{t('chart.notes.important')}</label>
              <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={save} data-loading={pending || undefined} disabled={pending}>{t('forms.entry.save')}</button>
            </>
          )}>
          <div
            className="stack"
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save() } }}
          >
            {forms.length > 1 && (
              <label className="fld">
                <span className="lbl">{t('forms.entry.pick')}</span>
                <select className="field" value={form.id} onChange={(e) => reset(e.target.value)}>
                  {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            )}
            {form.description && <p className="small muted" style={{ margin: 0 }}>{form.description}</p>}
            <FormFields
              key={form.id}
              idPrefix={'fe-' + form.id}
              fields={form.fields}
              values={values}
              errors={errors}
              disabled={pending}
              onChange={(k, v) => {
                setValues((cur) => ({ ...cur, [k]: v }))
                if (errors[k]) setErrors((cur) => { const n = { ...cur }; delete n[k]; return n })
              }}
            />
            <p className="small muted" style={{ margin: 0 }}>{t('forms.entry.requiredHint')} · {t('chart.notes.ctrlEnter')}</p>
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          </div>
        </Dialog>,
        document.body,
      )}
    </>
  )
}
