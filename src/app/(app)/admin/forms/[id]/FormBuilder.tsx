'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { FormFields, type RawValues } from '@/components/forms/FormFields'
import { FORM_FIELD_TYPES, FORM_LIMITS, fieldKey, normalizeFields, validateFormValues, type FieldError, type FormField, type FormFieldType } from '@/lib/forms'
import { saveFormAction } from '../actions'

const CATEGORIES = ['care', 'observation', 'physician', 'relatives', 'incident', 'handover'] as const

type Draft = { uid: string; key: string; label: string; type: FormFieldType; options: string; unit: string; min: string; max: string; required: boolean }
type Initial = { id: string; name: string; category: string; description: string; active: boolean; fields: FormField[] } | null

// Stabile IDs: Startfelder nach Position (gleich auf Server und Client), neue Felder erst nach Interaktion.
let seq = 0
const uid = () => 'n' + ++seq + Math.random().toString(36).slice(2, 6)
const toDraft = (f: FormField, i: number): Draft => ({
  uid: 'i' + i, key: f.key, label: f.label, type: f.type, options: (f.options ?? []).join('\n'), unit: f.unit ?? '',
  min: f.min != null ? String(f.min) : '', max: f.max != null ? String(f.max) : '', required: !!f.required,
})
const toPayload = (d: Draft) => ({ key: d.key, label: d.label, type: d.type, options: d.options, unit: d.unit, min: d.min, max: d.max, required: d.required })

/** Formular-Editor: Felder hinzufügen, sortieren, entfernen, mit Live-Vorschau (Admin → Formulare). */
export function FormBuilder({ initial }: { initial: Initial }) {
  const t = useT()
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'care')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [active, setActive] = useState(initial?.active ?? false)
  const [fields, setFields] = useState<Draft[]>(() => (initial?.fields.length ? initial.fields.map(toDraft) : [{ uid: 'i0', key: '', label: '', type: 'text', options: '', unit: '', min: '', max: '', required: false }]))
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [preview, setPreview] = useState<RawValues>({})
  const [previewErrors, setPreviewErrors] = useState<Record<string, FieldError>>({})

  const set = (i: number, patch: Partial<Draft>) => setFields((cur) => cur.map((f, n) => (n === i ? { ...f, ...patch } : f)))
  const move = (i: number, d: -1 | 1) => setFields((cur) => {
    const j = i + d
    if (j < 0 || j >= cur.length) return cur
    const next = [...cur]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const remove = (i: number) => setFields((cur) => cur.filter((_, n) => n !== i))
  const add = () => setFields((cur) => [...cur, { uid: uid(), key: '', label: '', type: 'text', options: '', unit: '', min: '', max: '', required: false }])

  // Vorschau: jedes gültige Feld einzeln, damit ein unfertiges Feld die übrigen nicht ausblendet.
  const previewFields = useMemo(() => {
    const out: FormField[] = []
    const seen = new Set<string>()
    fields.forEach((d, i) => {
      const r = normalizeFields([toPayload(d)])
      if (!r.ok) return
      const f = r.fields[0]
      const key = seen.has(f.key) ? f.key + '_' + i : f.key
      seen.add(key)
      out.push({ ...f, key })
    })
    return out
  }, [fields])

  const save = () => {
    setErr(null)
    const payload = { id: initial?.id, name, category, description, active, fields: fields.map(toPayload) }
    const check = normalizeFields(payload.fields)
    if (!check.ok) {
      setErr(check.index != null ? t('forms.errors.atField', { n: check.index + 1, error: t(check.error) }) : t(check.error))
      if (check.index != null) document.getElementById('fl-' + fields[check.index]?.uid)?.focus()
      return
    }
    if (name.trim().length < 2) { setErr(t('admin.errors.name')); document.getElementById('fb-name')?.focus(); return }
    start(async () => {
      const r = await saveFormAction(payload)
      if (!r.ok) { setErr(/^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error); return }
      const msg = r.message ?? 'common.saved'
      toast(/^[a-z]+\.[\w.]+$/.test(msg) ? t(msg) : msg)
      if (!initial && r.data) router.replace(`/admin/forms/${r.data.id}`)
    })
  }

  return (
    <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
      <div className="stack" style={{ minWidth: 0 }}>
        <section className="card" aria-labelledby="fb-master">
          <div className="card-head"><h2 id="fb-master">{t('forms.admin.master')}</h2></div>
          <div className="card-body form">
            <div className="form-grid">
              <label className="fld">
                <span className="lbl">{t('admin.config.name')}</span>
                <input id="fb-name" className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="fld">
                <span className="lbl">{t('forms.admin.category')}</span>
                <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t('chart.cat.' + c)}</option>)}
                </select>
                <span className="hint">{t('forms.admin.categoryHint')}</span>
              </label>
              <label className="fld span-all">
                <span className="lbl">{t('forms.admin.description')}</span>
                <input className="field" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="check span-all">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                <span>{t('forms.admin.activeLabel')}</span>
              </label>
            </div>
          </div>
        </section>

        <section className="stack-sm" aria-labelledby="fb-fields">
          <div className="sec-head">
            <h2 className="sec" id="fb-fields">{t('forms.admin.fields')} <span className="muted mono small">{fields.length}/{FORM_LIMITS.fields}</span></h2>
          </div>
          {fields.map((f, i) => {
            const hasOptions = f.type === 'select' || f.type === 'multiselect'
            const hasRange = f.type === 'number' || f.type === 'scale'
            const hasUnit = f.type === 'number' || f.type === 'text'
            return (
              <fieldset key={f.uid} className="card" style={{ padding: 0 }} aria-label={t('forms.admin.fieldN', { n: i + 1 })}>
                <div className="card-head" style={{ flexWrap: 'nowrap' }}>
                  <span className="mono small muted" aria-hidden="true" style={{ width: 18 }}>{i + 1}</span>
                  <input
                    id={'fl-' + f.uid}
                    className="field"
                    style={{ flex: 1, minWidth: 0 }}
                    value={f.label}
                    maxLength={FORM_LIMITS.label}
                    placeholder={t('forms.admin.labelPh')}
                    aria-label={t('forms.admin.label')}
                    onChange={(e) => set(i, { label: e.target.value })}
                  />
                  <select className="field" style={{ width: 'auto', flex: 'none' }} value={f.type} aria-label={t('forms.admin.type')} onChange={(e) => set(i, { type: e.target.value as FormFieldType })}>
                    {FORM_FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{t('forms.types.' + ty)}</option>)}
                  </select>
                </div>
                <div className="card-body stack-sm">
                  {(hasOptions || hasRange || hasUnit) && (
                    <div className="form-grid">
                      {hasOptions && (
                        <label className="fld span-all">
                          <span className="lbl">{t('forms.admin.options')}</span>
                          <textarea className="field" rows={4} value={f.options} onChange={(e) => set(i, { options: e.target.value })} style={{ minHeight: 84 }} />
                          <span className="hint">{t('forms.admin.optionsHint')}</span>
                        </label>
                      )}
                      {hasRange && (
                        <>
                          <label className="fld"><span className="lbl">{t('forms.admin.min')}</span><input className="field mono" inputMode="decimal" value={f.min} onChange={(e) => set(i, { min: e.target.value })} /></label>
                          <label className="fld"><span className="lbl">{t('forms.admin.max')}</span><input className="field mono" inputMode="decimal" value={f.max} onChange={(e) => set(i, { max: e.target.value })} /></label>
                        </>
                      )}
                      {hasUnit && (
                        <label className="fld"><span className="lbl">{t('forms.admin.unit')}</span><input className="field mono" value={f.unit} maxLength={16} placeholder="ml" onChange={(e) => set(i, { unit: e.target.value })} /></label>
                      )}
                    </div>
                  )}
                  <div className="row-between">
                    <label className="check small"><input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />{t('forms.admin.required')}</label>
                    <span className="row" style={{ gap: 4 }}>
                      <code className="mono small muted" title={t('forms.admin.keyHint')}>{f.key || fieldKey(f.label) || '–'}</code>
                      <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('forms.admin.up')} title={t('forms.admin.up')}>↑</button>
                      <button type="button" className="btn sm ghost" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={t('forms.admin.down')} title={t('forms.admin.down')}>↓</button>
                      <button type="button" className="btn sm ghost" disabled={fields.length <= 1} onClick={() => remove(i)}>{t('forms.admin.remove')}</button>
                    </span>
                  </div>
                </div>
              </fieldset>
            )
          })}
          <div className="row">
            <button type="button" className="btn" onClick={add} disabled={fields.length >= FORM_LIMITS.fields}>+ {t('forms.admin.addField')}</button>
          </div>
        </section>

        <div className="form-actions">
          <button type="button" className="btn primary" onClick={save} data-loading={pending || undefined} disabled={pending}>{t('common.save')}</button>
          {err && <span className="err" role="alert">{err}</span>}
        </div>
      </div>

      <section className="card" aria-labelledby="fb-preview" style={{ position: 'sticky', top: 0 }}>
        <div className="card-head"><h2 id="fb-preview">{t('forms.admin.preview')}</h2><span className="small muted">{t('forms.admin.previewHint')}</span></div>
        <div className="card-body stack">
          <div>
            <strong>{name || t('forms.admin.untitled')}</strong>
            {description && <p className="small muted" style={{ margin: '2px 0 0' }}>{description}</p>}
          </div>
          {previewFields.length ? (
            <FormFields
              idPrefix="pv"
              fields={previewFields}
              values={preview}
              errors={previewErrors}
              onChange={(k, v) => setPreview((cur) => ({ ...cur, [k]: v }))}
            />
          ) : <p className="small muted" style={{ margin: 0 }}>{t('forms.admin.previewEmpty')}</p>}
          <div className="row">
            <button type="button" className="btn sm" onClick={() => setPreviewErrors(validateFormValues(previewFields, preview).errors)}>{t('forms.admin.previewCheck')}</button>
            <button type="button" className="btn sm ghost" onClick={() => { setPreview({}); setPreviewErrors({}) }}>{t('forms.admin.previewReset')}</button>
          </div>
        </div>
      </section>
    </div>
  )
}
