'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { DateField, DateTimeField, RadioGroup, Select, TextField } from '@/components/ui/fields'
import { adtAction } from './actions'

type Opt = { id: string; label: string }
export type StayProps = {
  residentId: string
  who: string
  absent: boolean
  unitId: string
  roomId: string | null
  units: Opt[]
  /** Freie Zimmer je Bereich (inkl. eigenes Zimmer im aktuellen Bereich) */
  rooms: Record<string, Opt[]>
  now: string
  today: string
}

const REASONS = ['hospital', 'holiday', 'relatives', 'rehab', 'other'] as const

/** Aufenthalt (PRD §43): Abwesenheit erfassen, Rückkehr erfassen, Verlegen – je ein Dialog mit Personenkontext. */
export function StayActions(p: StayProps) {
  const t = useT()
  const [mode, setMode] = useState<'leave' | 'return' | 'transfer' | null>(null)
  const [reason, setReason] = useState<string>('hospital')
  const [unit, setUnit] = useState(p.unitId)
  const close = () => setMode(null)
  const ctx = <span>{p.who}</span>
  const foot = (label: string) => (
    <div className="form-actions">
      <span className="spacer" />
      <button type="button" className="btn" onClick={close}>{t('common.cancel')}</button>
      <button type="submit" className="btn primary">{label}</button>
    </div>
  )
  return (
    <div className="row">
      {p.absent
        ? <button type="button" className="btn sm primary" onClick={() => setMode('return')}>{t('residents.adt.return')}</button>
        : <button type="button" className="btn sm" onClick={() => { setReason('hospital'); setMode('leave') }}>{t('residents.adt.leave')}</button>}
      {p.units.length > 0 && <button type="button" className="btn sm" onClick={() => { setUnit(p.unitId); setMode('transfer') }}>{t('residents.adt.transfer')}</button>}

      {mode === 'leave' && (
        <Dialog open onClose={close} title={t('residents.adt.leaveTitle')} context={ctx}>
          <ActionForm action={adtAction.bind(null, p.residentId)} reset={false} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="event" value="leave" />
            <div className="form-grid">
              <RadioGroup label={t('residents.adt.reason')} name="reason" value={reason} onChange={(v: string) => setReason(v)} wrapClassName="span-all" inline
                options={REASONS.map((k) => ({ value: k, label: t('residents.adt.reasons.' + k) }))} />
              <TextField label={t(reason === 'other' ? 'residents.adt.reason' : 'residents.adt.note')} optional={reason !== 'other'} required={reason === 'other'} name="note" maxLength={160} wrapClassName="span-all" placeholder={t('residents.adt.notePh')} />
              <DateTimeField label={t('residents.adt.since')} name="at" defaultValue={p.now} max={p.now} required />
              <DateField label={t('residents.adt.expectedReturn')} optional name="expectedReturn" min={p.today} />
            </div>
            <p className="small fg2" style={{ margin: 0 }}>{t('residents.adt.leaveHint')}</p>
            {foot(t('residents.adt.leave'))}
          </ActionForm>
        </Dialog>
      )}
      {mode === 'return' && (
        <Dialog open onClose={close} title={t('residents.adt.returnTitle')} context={ctx}>
          <ActionForm action={adtAction.bind(null, p.residentId)} reset={false} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="event" value="return" />
            <div className="form-grid">
              <DateTimeField label={t('residents.adt.at')} name="at" defaultValue={p.now} max={p.now} required />
              <Select label={t('residents.adt.room')} name="roomId" defaultValue="">
                <option value="">{t('residents.adt.sameRoom')}</option>
                {(p.rooms[p.unitId] ?? []).filter((r) => r.id !== p.roomId).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </div>
            <p className="small fg2" style={{ margin: 0 }}>{t('residents.adt.returnHint')}</p>
            {foot(t('residents.adt.return'))}
          </ActionForm>
        </Dialog>
      )}
      {mode === 'transfer' && (
        <Dialog open onClose={close} title={t('residents.adt.transferTitle')} context={ctx}>
          <ActionForm action={adtAction.bind(null, p.residentId)} reset={false} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="event" value="transfer" />
            <div className="form-grid">
              <Select label={t('residents.adt.unit')} name="unitId" value={unit} onChange={(e) => setUnit(e.target.value)} required>
                {p.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </Select>
              <Select key={unit} label={t('residents.adt.room')} name="roomId" defaultValue={unit === p.unitId ? p.roomId ?? '' : ''}>
                <option value="">{t('residents.adt.noRoom')}</option>
                {(p.rooms[unit] ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <DateTimeField label={t('residents.adt.at')} name="at" defaultValue={p.now} max={p.now} required />
              <TextField label={t('residents.adt.note')} optional name="note" maxLength={160} placeholder={t('residents.adt.transferPh')} />
            </div>
            <p className="small fg2" style={{ margin: 0 }}>{t('residents.adt.transferHint')}</p>
            {foot(t('residents.adt.transfer'))}
          </ActionForm>
        </Dialog>
      )}
    </div>
  )
}
