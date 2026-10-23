'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import { ResidentContext } from '@/components/meds/shared'
import type { ResidentCtxDto } from '@/components/meds/types'
import { DateField, NumberField, TextField } from '@/components/ui/fields'
import { cancelOrderAction, countAction, orderAction, orderListText, receiveAction } from './actions'

export type SuggestDto = { medicationId: string; drug: string; resident: string; stock: string; reach: string; qty: number; unit: string }

/** Bestellvorschlag: Mengen anpassen (0/leer = nicht bestellen), dann alle Positionen in einem Schritt bestellen. */
export function SuggestTable({ rows }: { rows: SuggestDto[] }) {
  const t = useT()
  const [qty, setQty] = useState<Record<string, number | ''>>(() => Object.fromEntries(rows.map((r) => [r.medicationId, r.qty])))
  const [pending, start] = useTransition()
  const n = Object.values(qty).filter((v) => typeof v === 'number' && v > 0).length
  const submit = () => start(async () => {
    const r = await orderAction(rows.map((x) => ({ medicationId: x.medicationId, quantity: qty[x.medicationId] ?? '' })))
    toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' })
  })
  return (
    <>
      <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
        <table className="stable">
          <thead><tr><th>{t('meds.pharmacy.col.drug')}</th><th>{t('meds.pharmacy.col.resident')}</th><th className="right">{t('meds.pharmacy.col.stock')}</th><th>{t('meds.pharmacy.col.reach')}</th><th>{t('meds.pharmacy.col.qty')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.medicationId}>
                <th scope="row" style={{ fontWeight: 500 }}>{r.drug}</th>
                <td>{r.resident}</td>
                <td className="right num nowrap">{r.stock}</td>
                <td className="nowrap"><span className="tag warn">{r.reach}</span></td>
                <td style={{ minWidth: '9rem' }}>
                  <NumberField aria-label={`${t('meds.pharmacy.col.qty')}: ${r.drug}, ${r.resident}`} min={0} max={10000} step={1} value={qty[r.medicationId] ?? ''} unit={r.unit} wrapStyle={{ maxWidth: '10rem' }}
                    onChange={(v) => setQty((q) => ({ ...q, [r.medicationId]: v }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn primary" disabled={pending || !n} data-loading={pending || undefined} onClick={submit}>{t('meds.pharmacy.orderN', { n })}</button>
      </div>
    </>
  )
}

export function CopyOrderList() {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => {
      const r = await orderListText()
      if (!r.ok || !r.data) return toast(t(r.ok ? 'common.genericError' : r.error), { kind: 'crit' })
      try { await navigator.clipboard.writeText(r.data.text); toast(t('meds.pharmacy.copied')) } catch { toast(t('common.genericError'), { kind: 'crit' }) }
    })}>{t('meds.pharmacy.copy')}</button>
  )
}

export function ReceiveButton({ medicationId, orderId, drug, qty, unit, resident, todayKey }: { medicationId: string; orderId?: string; drug: string; qty?: number; unit: string; resident: ResidentCtxDto; todayKey: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className={'btn sm' + (orderId ? ' primary' : '')} onClick={() => setOpen(true)}>{t('meds.pharmacy.receive')}</button>
      {open && (
        <Dialog open onClose={close} title={t('meds.pharmacy.receiveTitle')} context={<><ResidentContext r={resident} /><span>{drug}</span></>}>
          <ActionForm action={receiveAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="medicationId" value={medicationId} />
            <input type="hidden" name="orderId" value={orderId ?? ''} />
            <div className="form-grid">
              <NumberField label={t('meds.pharmacy.quantity')} name="quantity" min={1} max={10000} step={1} defaultValue={qty ?? ''} unit={unit} required />
              <TextField label={t('meds.pharmacy.batch')} name="batch" required maxLength={40} className="mono" autoComplete="off" />
              <DateField label={t('meds.pharmacy.expiry')} name="expiry" min={todayKey} required />
            </div>
            <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={close}>{t('common.cancel')}</button><button type="submit" className="btn primary">{t('meds.pharmacy.receive')}</button></div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

export function CountButton({ medicationId, drug, stock, unit, resident }: { medicationId: string; drug: string; stock: number; unit: string; resident: ResidentCtxDto }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)}>{t('meds.pharmacy.count')}</button>
      {open && (
        <Dialog open onClose={close} title={t('meds.pharmacy.countTitle')} context={<><ResidentContext r={resident} /><span>{drug}</span></>}>
          <ActionForm action={countAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="medicationId" value={medicationId} />
            <div className="form-grid">
              <NumberField label={t('meds.pharmacy.counted')} name="counted" min={0} max={100000} step={1} defaultValue={stock} unit={unit} required />
              <TextField label={t('meds.pharmacy.note')} name="note" required maxLength={300} placeholder={t('meds.pharmacy.notePh')} />
            </div>
            <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={close}>{t('common.cancel')}</button><button type="submit" className="btn primary">{t('common.save')}</button></div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

export function CancelOrder({ id, drug }: { id: string; drug: string }) {
  const t = useT()
  const [ask, dialog] = useConfirm()
  const [pending, start] = useTransition()
  return (
    <>
      <button type="button" className="btn sm danger" disabled={pending} onClick={async () => {
        if (!(await ask({ ...splitQuestion(t('meds.pharmacy.cancelQ', { drug })), danger: true, confirmLabel: t('meds.pharmacy.cancel') }))) return
        start(async () => { const r = await cancelOrderAction(id); toast(r.ok ? r.message ?? '' : t(r.error), r.ok ? undefined : { kind: 'crit' }) })
      }}>{t('meds.pharmacy.cancel')}</button>
      {dialog}
    </>
  )
}
