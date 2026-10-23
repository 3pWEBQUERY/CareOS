'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { RadioGroup, Select, TextField } from '@/components/ui/fields'
import { ActButton } from '../../team/_ui/ActButton'
import { deleteWishAction, saveWishAction } from '../roster-actions'

export type WishValue = { kind: 'off' | 'shift'; shiftTypeId: string | null; code: string | null; note: string | null }

/** Dienstwunsch für einen Tag erfassen, ändern oder löschen (Monatsansicht «Meine Dienste»). */
export function WishButton({ date, dateLabel, wish, types, hint }: {
  date: string
  dateLabel: string
  wish: WishValue | null
  types: { id: string; code: string; name: string }[]
  hint: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'off' | 'shift'>(wish?.kind ?? 'off')
  const label = wish ? (wish.kind === 'off' ? t('roster.wish.short.off') : wish.code ?? '') : '+ ' + t('roster.wish.add')
  return (
    <>
      <button type="button" className={'wish-btn' + (wish ? ' on' : '')} onClick={() => setOpen(true)} aria-label={t('roster.wish.dayTitle', { date: dateLabel }) + (wish ? `: ${wish.kind === 'off' ? t('roster.wish.off') : wish.code}` : '')}>
        <span aria-hidden="true">{label}</span>
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={t('roster.wish.dayTitle', { date: dateLabel })}>
          <ActionForm action={saveWishAction} success="roster.wish.saved" onDone={(r) => r.ok && setOpen(false)} reset={false}>
            <input type="hidden" name="date" value={date} />
            <RadioGroup label={t('roster.wish.kind')} name="kind" value={kind} onChange={(v) => setKind(v === 'shift' ? 'shift' : 'off')} variant="seg"
              options={[{ value: 'off', label: t('roster.wish.off') }, { value: 'shift', label: t('roster.wish.shift') }]} />
            {kind === 'shift' && (
              <Select label={t('roster.wish.type')} name="shiftTypeId" defaultValue={wish?.shiftTypeId ?? types[0]?.id}>
                {types.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
              </Select>
            )}
            <TextField label={t('roster.wish.note')} name="note" optional maxLength={200} defaultValue={wish?.note ?? ''} />
            <p className="small muted" style={{ margin: 0 }}>{hint}</p>
            <div className="form-actions">
              <Submit>{t('common.save')}</Submit>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
              <span className="spacer" />
              {wish && <ActButton action={async () => { const r = await deleteWishAction(date); if (r.ok) setOpen(false); return r }} className="btn ghost danger">{t('roster.wish.delete')}</ActButton>}
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}
