'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useUnsavedGuard } from '@/components/admin/ui'
import { FormFields, type RawValues } from '@/components/forms/FormFields'
import { FORM_FIELD_TYPES, FORM_LIMITS, fieldKey, normalizeFields, validateFormValues, type FieldError, type FormField, type FormFieldType } from '@/lib/forms'
import { saveFormAction } from '../actions'
import { Checkbox, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'

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

  const [live, setLive] = useState('')
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const focusNext = useRef<string | null>(null)
  useEffect(() => {
    if (!focusNext.current) return
    const el = document.getElementById(focusNext.current) as HTMLButtonElement | HTMLInputElement | null
    focusNext.current = null
    if (el && !(el as HTMLButtonElement).disabled) el.focus()
    else el?.parentElement?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  })
  // Ungespeicherte Änderungen erkennen (Vergleich mit dem zuletzt gespeicherten Stand)
  const snapshot = () => JSON.stringify({ name, category, description, active, fields: fields.map(toPayload) })
  const saved = useRef<string | null>(null)
  if (saved.current === null) saved.current = snapshot()
  const dirty = snapshot() !== saved.current
  const leaveDialog = useUnsavedGuard(dirty, t('admin.ux.unsaved'))

  const fieldName = (f: Draft, i: number) => f.label.trim() || t('forms.admin.fieldN', { n: i + 1 })
  const set = (i: number, patch: Partial<Draft>) => setFields((cur) => cur.map((f, n) => (n === i ? { ...f, ...patch } : f)))
  const moveTo = (from: number, to: number, focusId?: string) => {
    if (from === to || to < 0 || to >= fields.length) return
    const next = [...fields]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    setFields(next)
    setLive(t('admin.ux.fieldMoved', { name: fieldName(it, from), pos: to + 1, total: next.length }))
    if (focusId) focusNext.current = focusId
  }
  const move = (i: number, d: -1 | 1) => moveTo(i, i + d, `fb-${d < 0 ? 'up' : 'dn'}-${fields[i].uid}`)
  const remove = (i: number) => {
    const gone = fields[i]
    const prev = fields
    setFields((cur) => cur.filter((_, n) => n !== i))
    focusNext.current = 'fl-' + (fields[i + 1] ?? fields[i - 1])?.uid
    toast(t('admin.ux.fieldRemoved', { name: fieldName(gone, i) }), { undo: () => setFields(prev), undoLabel: t('admin.ux.undo') })
  }
  const add = () => {
    const f: Draft = { uid: uid(), key: '', label: '', type: 'text', options: '', unit: '', min: '', max: '', required: false }
    setFields((cur) => [...cur, f])
    focusNext.current = 'fl-' + f.uid
  }

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
      saved.current = snapshot()
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
              <TextField label={t('admin.config.name')} id="fb-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <Select label={t('forms.admin.category')} hint={t('forms.admin.categoryHint')} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t('chart.cat.' + c)}</option>)}
                </Select>
              <TextField label={t('forms.admin.description')} wrapClassName="span-all" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
              <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} label={t('forms.admin.activeLabel')} wrapClassName="span-all" />
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
              <fieldset
                key={f.uid}
                className="card fb-field"
                data-drag={drag === i || undefined}
                data-over={over === i && drag !== null && drag !== i ? (drag < i ? 'after' : 'before') : undefined}
                style={{ padding: 0 }}
                aria-label={t('forms.admin.fieldN', { n: i + 1 })}
                onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(i) }}
                onDrop={(e) => { e.preventDefault(); if (drag !== null) moveTo(drag, i); setDrag(null); setOver(null) }}
              >
                <div className="card-head" style={{ flexWrap: 'nowrap' }}>
                  <span
                    className="fb-grip mono small"
                    draggable
                    title={t('admin.ux.dragHint')}
                    aria-hidden="true"
                    onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                    onDragEnd={() => { setDrag(null); setOver(null) }}
                  >
                    {i + 1}
                  </span>
                  <TextField
                    id={'fl-' + f.uid}

                    style={{ flex: 1, minWidth: 0 }}
                    value={f.label}
                    maxLength={FORM_LIMITS.label}
                    placeholder={t('forms.admin.labelPh')}
                    aria-label={t('forms.admin.label')}
                    onChange={(e) => set(i, { label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                      e.preventDefault()
                      if (i === fields.length - 1) { if (f.label.trim() && fields.length < FORM_LIMITS.fields) add() }
                      else document.getElementById('fl-' + fields[i + 1].uid)?.focus()
                    }}
                    aria-describedby="fb-enter-hint" />
                  <Select style={{ width: 'auto', flex: 'none' }} value={f.type} aria-label={t('forms.admin.type')} onChange={(e) => set(i, { type: e.target.value as FormFieldType })}>
                    {FORM_FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{t('forms.types.' + ty)}</option>)}
                  </Select>
                </div>
                <div className="card-body stack-sm">
                  {(hasOptions || hasRange || hasUnit) && (
                    <div className="form-grid">
                      {hasOptions && (
                        <Textarea label={t('forms.admin.options')} hint={t('forms.admin.optionsHint')} wrapClassName="span-all" rows={4} value={f.options} onChange={(e) => set(i, { options: e.target.value })} style={{ minHeight: 84 }} />
                      )}
                      {hasRange && (
                        <>
                          <NumberField label={t('forms.admin.min')} value={f.min === '' ? '' : Number(f.min)} max={f.max === '' ? undefined : Number(f.max)} onChange={(v) => set(i, { min: v === '' ? '' : String(v) })} />
                          <NumberField label={t('forms.admin.max')} value={f.max === '' ? '' : Number(f.max)} min={f.min === '' ? undefined : Number(f.min)} onChange={(v) => set(i, { max: v === '' ? '' : String(v) })} />
                        </>
                      )}
                      {hasUnit && (
                        <TextField label={t('forms.admin.unit')} value={f.unit} maxLength={16} placeholder="ml" onChange={(e) => set(i, { unit: e.target.value })} className="mono" />
                      )}
                    </div>
                  )}
                  <div className="row-between">
                    <Checkbox checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} label={t('forms.admin.required')} wrapClassName="small" />
                    <span className="row" style={{ gap: 4 }}>
                      <code className="mono small muted" title={t('forms.admin.keyHint')}>{f.key || fieldKey(f.label) || '–'}</code>
                      <button type="button" id={'fb-up-' + f.uid} className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t('forms.admin.up')}: ${fieldName(f, i)}`} title={t('forms.admin.up')}>↑</button>
                      <button type="button" id={'fb-dn-' + f.uid} className="btn sm ghost" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={`${t('forms.admin.down')}: ${fieldName(f, i)}`} title={t('forms.admin.down')}>↓</button>
                      <button type="button" className="btn sm ghost" disabled={fields.length <= 1} onClick={() => remove(i)} aria-label={`${t('forms.admin.remove')}: ${fieldName(f, i)}`}>{t('forms.admin.remove')}</button>
                    </span>
                  </div>
                </div>
              </fieldset>
            )
          })}
          <div className="row">
            <button type="button" className="btn" onClick={add} disabled={fields.length >= FORM_LIMITS.fields}>+ {t('forms.admin.addField')}</button>
            <span className="small muted" id="fb-enter-hint">{t('admin.ux.enterHint')}</span>
          </div>
          <p className="sr-only" aria-live="polite">{live}</p>
        </section>

        <div className="form-actions pm-bar">
          <span className="small" aria-live="polite">{dirty ? t('admin.ux.unsavedShort') : <span className="muted">{t('admin.roles.noChanges')}</span>}</span>
          <span className="spacer" />
          {err && <span className="err" role="alert">{err}</span>}
          <button type="button" className="btn primary" onClick={save} data-loading={pending || undefined} disabled={pending}>{t('common.save')}</button>
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
      {leaveDialog}
    </div>
  )
}
