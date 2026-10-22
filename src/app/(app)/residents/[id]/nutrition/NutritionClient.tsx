'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { PORTIONS, QUICK_ML, portionLabel } from '@/lib/care'
import { addDrinkAction, addFluidAction, addMealAction, saveProfileAction, undoIntakeAction } from './actions'
import { FLUID_IN, FLUID_LIMITS, FLUID_OUT } from '@/lib/fluid-balance'
import { isOffline, isQueued, orQueue } from '@/lib/offline/client'
import { Combobox, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'

function useTr() {
  const t = useT()
  return (s: string, vars?: Record<string, string | number>) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s, vars) : s)
}

export function DrinkQuick({ residentId, defaultItem }: { residentId: string; defaultItem: string }) {
  const t = useT()
  const tr = useTr()
  const [item, setItem] = useState(defaultItem)
  const [ml, setMl] = useState('')
  const [pending, start] = useTransition()
  const items = t('care.nutrition.itemList').split(',')
  const add = (amount: number) =>
    start(async () => {
      // Ohne Verbindung: verschlüsselt vormerken und später synchronisieren (PRD §39)
      if (isOffline() && !(Number.isInteger(amount) && amount >= 10 && amount <= 2000)) return toast(tr('care.nutrition.errors.amount'), { kind: 'crit' })
      const r = await orQueue(() => addDrinkAction(residentId, amount, item), { kind: 'intake', residentId, data: { type: 'drink', ml: amount, item: item.trim().slice(0, 120) || undefined } })
      if (isQueued(r)) { if (amount === Number(ml)) setMl(''); return toast(t(r.message)) }
      if (!r.ok) return toast(tr(r.error), { kind: 'crit' })
      if (amount === Number(ml)) setMl('')
      const id = r.data?.id
      toast(t('care.nutrition.added', { ml: amount }) + (item ? ' · ' + item : ''), {
        undoLabel: t('common.undo'),
        undo: id ? async () => {
          const u = await undoIntakeAction(residentId, id)
          toast(tr(u.ok ? u.message ?? 'care.nutrition.removed' : u.error), u.ok ? {} : { kind: 'crit' })
        } : undefined,
      })
    })
  return (
    <div className="stack-sm">
      <Combobox label={t('care.nutrition.item')} id="dq-item" value={item} onChange={(v) => setItem(v)} freeText maxLength={120} placeholder=" " options={items.map((s) => ({ value: s, label: s }))} />
      <div className="quick-ml" role="group" aria-label={t('care.nutrition.quickAdd')}>
        {QUICK_ML.map((v) => (
          <button key={v} type="button" className="btn lg" disabled={pending} onClick={() => add(v)}>+{v} ml</button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Number(ml); if (n) add(n) }}>
        <NumberField label={t('care.nutrition.customMl')} hideLabel id="dq-ml" wrapStyle={{ width: '9.5rem' }} placeholder={t('care.nutrition.customMl')} unit="ml" min={10} max={2000} step={1}
          value={ml === '' ? '' : Number(ml)} onChange={(v) => setMl(v === '' ? '' : String(v))} />
        <button type="submit" className="btn" disabled={pending || !ml}>{t('care.nutrition.add')}</button>
      </form>
    </div>
  )
}

export function MealPortion({ residentId, meal, mealLabel, current }: { residentId: string; meal: string; mealLabel: string; current: number | null }) {
  const t = useT()
  const tr = useTr()
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useState<number | null>(null)
  const shown = optimistic ?? current
  const pick = (p: number) =>
    start(async () => {
      setOptimistic(p)
      const r = await orQueue(() => addMealAction(residentId, meal, p), { kind: 'intake', residentId, data: { type: 'meal', meal, portion: p } })
      if (isQueued(r)) return toast(t(r.message))
      setOptimistic(null)
      if (!r.ok) return toast(tr(r.error), { kind: 'crit' })
      const id = r.data?.id
      toast(t('care.nutrition.portionSaved', { meal: mealLabel, portion: portionLabel(p) }), {
        undoLabel: t('common.undo'),
        undo: id ? async () => { const u = await undoIntakeAction(residentId, id); toast(tr(u.ok ? 'care.nutrition.removed' : u.error)) } : undefined,
      })
    })
  return (
    <div className="seg portion" role="group" aria-label={t('care.nutrition.portion') + ': ' + mealLabel}>
      {PORTIONS.map((p) => (
        <button key={p} type="button" aria-pressed={shown === p} disabled={pending} aria-label={t('care.nutrition.portionAria', { meal: mealLabel, portion: portionLabel(p) })} onClick={() => pick(p)}>
          {portionLabel(p)}
        </button>
      ))}
    </div>
  )
}

export type ProfileValues = { dietForm: string; texture: string; intolerances: string; supplements: string; swallowing: string; fluidTargetMl: string; notes: string }

export function ProfileButton({ residentId, values, contextLabel }: { residentId: string; values: ProfileValues; contextLabel: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const diets = t('care.nutrition.dietList').split(',')
  const textures = t('care.nutrition.textureList').split(',')
  const fld = (name: keyof ProfileValues, opts: { list?: string[]; area?: boolean; num?: boolean; hint?: string; span?: boolean } = {}) => (
    <NutritionField key={name} name={name} label={t('care.nutrition.fields.' + (name === 'fluidTargetMl' ? 'fluidTarget' : name))} value={values[name]} {...opts} />
  )
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('care.nutrition.editProfile')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('care.nutrition.profile')} context={contextLabel} wide>
        <ActionForm action={(f) => saveProfileAction(residentId, f)} reset={false} onDone={(r) => r.ok && setOpen(false)}>
          <div className="form-grid">
            {fld('dietForm', { list: diets })}
            {fld('texture', { list: textures })}
            {fld('fluidTargetMl', { num: true })}
            {fld('intolerances', { hint: t('care.nutrition.fields.intolerancesHint') })}
            {fld('supplements')}
            {fld('swallowing')}
            {fld('notes', { area: true, span: true })}
          </div>
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <Submit>{t('common.save')}</Submit>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}

/** Feld im Ernährungsprofil: Auswahl mit freiem Text, Zahl (ml) oder Text. */
function NutritionField({ name, label, value, list, area, num, hint, span }: { name: string; label: string; value: string; list?: string[]; area?: boolean; num?: boolean; hint?: string; span?: boolean }) {
  const common = { id: 'np-' + name, name, label, hint, wrapClassName: span ? 'span-all' : undefined }
  if (area) return <Textarea {...common} rows={2} style={{ minHeight: 56 }} defaultValue={value} />
  if (num) return <NumberField {...common} defaultValue={value} min={500} max={4000} step={1} />
  if (list) return <Combobox {...common} defaultValue={value} freeText maxLength={120} placeholder=" " options={list.map((s) => ({ value: s, label: s }))} />
  return <TextField {...common} defaultValue={value} autoComplete="off" />
}

/**
 * Ausfuhr bzw. Einfuhr über Infusion/Sonde erfassen (Flüssigkeitsbilanz, PRD §14). Häufigste Art (Urin) vorgewählt,
 * Menge in ml mit Plausibilitätsgrenze, Rückgängig im Toast; ohne Verbindung vorgemerkt.
 */
export function FluidEntry({ residentId }: { residentId: string }) {
  const t = useT()
  const tr = useTr()
  const [kind, setKind] = useState<string>('out_urine')
  const [ml, setMl] = useState<number | ''>('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const save = () => {
    if (ml === '' || ml < FLUID_LIMITS.min || ml > FLUID_LIMITS.max) return setErr(t('care.fluid.errors.amount'))
    setErr(null)
    const amount = Math.round(ml)
    start(async () => {
      const r = await orQueue(() => addFluidAction(residentId, kind, amount, note), { kind: 'intake', residentId, data: { type: 'fluid', fluid: kind, ml: amount, item: note.trim().slice(0, 120) || undefined } })
      if (isQueued(r)) { setMl(''); setNote(''); return toast(t(r.message)) }
      if (!r.ok) return setErr(tr(r.error))
      setMl(''); setNote('')
      const id = r.data?.id
      toast(t('care.fluid.saved', { kind: t('care.fluid.kinds.' + kind), ml: amount }), {
        undoLabel: t('common.undo'),
        undo: id ? async () => { const u = await undoIntakeAction(residentId, id); toast(tr(u.ok ? 'care.nutrition.removed' : u.error), u.ok ? {} : { kind: 'crit' }) } : undefined,
      })
    })
  }
  return (
    <form className="fluid-form" noValidate onSubmit={(e) => { e.preventDefault(); save() }}>
      <Select label={t('care.fluid.kind')} value={kind} onChange={(e) => setKind(e.target.value)}>
        <optgroup label={t('care.fluid.out')}>
          {FLUID_OUT.map((k) => <option key={k} value={k}>{t('care.fluid.kinds.' + k)}</option>)}
        </optgroup>
        <optgroup label={t('care.fluid.in')}>
          {FLUID_IN.map((k) => <option key={k} value={k}>{t('care.fluid.kinds.' + k)}</option>)}
        </optgroup>
      </Select>
      <NumberField label={t('care.fluid.amount')} unit="ml" min={FLUID_LIMITS.min} max={FLUID_LIMITS.max} step={1} value={ml} onChange={(v) => { setMl(v === '' ? '' : Number(v)); setErr(null) }} error={err ?? undefined} />
      <TextField label={t('care.fluid.note')} optional value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={t('care.fluid.notePh')} />
      <button type="submit" className="btn primary" disabled={pending} data-loading={pending || undefined}>{t('care.fluid.save')}</button>
    </form>
  )
}
