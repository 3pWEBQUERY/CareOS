'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { PORTIONS, QUICK_ML, portionLabel } from '@/lib/care'
import { addDrinkAction, addMealAction, saveProfileAction, undoIntakeAction } from './actions'

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
      const r = await addDrinkAction(residentId, amount, item)
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
      <label className="fld" htmlFor="dq-item">
        <span className="lbl">{t('care.nutrition.item')}</span>
        <input id="dq-item" className="field" list="dq-items" value={item} maxLength={120} autoComplete="off" onChange={(e) => setItem(e.target.value)} />
        <datalist id="dq-items">{items.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <div className="quick-ml" role="group" aria-label={t('care.nutrition.quickAdd')}>
        {QUICK_ML.map((v) => (
          <button key={v} type="button" className="btn lg" disabled={pending} onClick={() => add(v)}>+{v} ml</button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const n = Number(ml); if (n) add(n) }}>
        <label className="sr-only" htmlFor="dq-ml">{t('care.nutrition.customMl')}</label>
        <input id="dq-ml" className="field mono" style={{ width: 120 }} inputMode="numeric" placeholder={t('care.nutrition.customMl')} value={ml} onChange={(e) => setMl(e.target.value.replace(/[^\d]/g, ''))} />
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
      const r = await addMealAction(residentId, meal, p)
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
    <label className={'fld' + (opts.span ? ' span-all' : '')} htmlFor={'np-' + name}>
      <span className="lbl">{t('care.nutrition.fields.' + (name === 'fluidTargetMl' ? 'fluidTarget' : name))}</span>
      {opts.area ? (
        <textarea id={'np-' + name} name={name} className="field" rows={2} style={{ minHeight: 56 }} defaultValue={values[name]} />
      ) : (
        <input id={'np-' + name} name={name} className={'field' + (opts.num ? ' mono' : '')} defaultValue={values[name]} list={opts.list ? 'np-l-' + name : undefined} inputMode={opts.num ? 'numeric' : undefined} autoComplete="off" />
      )}
      {opts.list && <datalist id={'np-l-' + name}>{opts.list.map((s) => <option key={s} value={s} />)}</datalist>}
      {opts.hint && <span className="hint">{opts.hint}</span>}
    </label>
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
