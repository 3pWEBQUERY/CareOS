'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconPlus } from '@/components/icons'
import { saveAppointment, setAppointmentDone } from './actions'
import { Checkbox, DateField, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'

export type ApptRow = { id: string; title: string; kind: string; place: string | null; notes: string | null; done: boolean; date: string; time: string; label: string; today: boolean; past: boolean }

const KINDS = ['physician', 'therapy', 'hospital', 'relatives', 'other']
const TONE: Record<string, string> = { physician: 'violet', therapy: 'accent', hospital: 'crit', relatives: '', other: '' }

export function Appointments({ residentId, who, upcoming, past, canWrite, today }: { residentId: string; who: string; upcoming: ApptRow[]; past: ApptRow[]; canWrite: boolean; today: string }) {
  const t = useT()
  const [edit, setEdit] = useState<ApptRow | 'new' | null>(null)
  const [, start] = useTransition()
  const kind = (k: string) => (KINDS.includes(k) ? k : 'other')
  const done = (a: ApptRow, v: boolean) => start(async () => {
    const r = await setAppointmentDone(residentId, a.id, v)
    if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
    toast(t(v ? 'residents.appointments.markedDone' : 'residents.appointments.markedOpen', { title: a.title }), { undo: () => void setAppointmentDone(residentId, a.id, !v), undoLabel: t('common.undo') })
  })
  const list = (rows: ApptRow[], emptyKey: string) => rows.length ? (
    <ul className="list card">
      {rows.map((a) => (
        <li key={a.id} className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <time className={'mono small nowrap' + (a.today && !a.done ? ' warn-text' : ' fg2')} style={{ minWidth: 150 }}>{a.label}</time>
          <span className={'tag ' + TONE[kind(a.kind)]} style={{ flex: 'none' }}>{t('residents.appointments.kinds.' + kind(a.kind))}</span>
          <div className="grow" style={{ minWidth: 180 }}>
            <div style={a.done ? { textDecoration: 'line-through', color: 'var(--fg-3)' } : undefined}>{a.title}</div>
            {(a.place || a.notes) && <div className="small muted">{[a.place, a.notes].filter(Boolean).join(' · ')}</div>}
          </div>
          {a.done && <span className="tag ok">{t('residents.appointments.doneTag')}</span>}
          {!a.done && a.past && <span className="tag warn">{t('residents.appointments.pastOpen')}</span>}
          {canWrite && (
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <button type="button" className="btn sm" onClick={() => done(a, !a.done)}>{t(a.done ? 'residents.appointments.reopen' : 'residents.appointments.markDone')}</button>
              <button type="button" className="btn sm ghost" onClick={() => setEdit(a)}>{t('common.edit')}</button>
            </span>
          )}
        </li>
      ))}
    </ul>
  ) : <p className="empty">{t(emptyKey)}</p>

  const cur = edit === 'new' ? null : edit
  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('residents.appointments.upcoming')}</h2>
        {canWrite && <button type="button" className="btn sm primary" onClick={() => setEdit('new')}><IconPlus size={14} />{t('residents.appointments.add')}</button>}
      </div>
      {list(upcoming, 'residents.appointments.noneUpcoming')}
      <div className="sec-head"><h2 className="sec">{t('residents.appointments.past')}</h2></div>
      {list(past, 'residents.appointments.nonePast')}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={t(cur ? 'residents.appointments.edit' : 'residents.appointments.add')} context={<span>{who}</span>}>
        {edit && (
          <ActionForm key={cur?.id ?? 'new'} action={saveAppointment.bind(null, residentId, cur?.id ?? null)} success="common.saved" onDone={(r) => r.ok && setEdit(null)}>
            <div className="form-grid">
              <TextField label={t('residents.appointments.fTitle')} wrapClassName="span-all" name="title" required maxLength={200} defaultValue={cur?.title} />
              <Select label={t('residents.appointments.fKind')} name="kind" defaultValue={cur ? kind(cur.kind) : 'physician'}>{KINDS.map((k) => <option key={k} value={k}>{t('residents.appointments.kinds.' + k)}</option>)}</Select>
              <DateField label={t('residents.appointments.fDate')} name="date" required defaultValue={cur?.date ?? today} />
              <TimeField label={t('residents.appointments.fTime')} name="time" required defaultValue={cur?.time ?? '10:00'} />
              <TextField label={t('residents.appointments.fPlace')} name="place" maxLength={200} defaultValue={cur?.place ?? ''} />
              <Textarea label={t('residents.appointments.fNotes')} wrapClassName="span-all" name="notes" rows={3} maxLength={2000} defaultValue={cur?.notes ?? ''} />
              {cur && <Checkbox name="done" defaultChecked={cur.done} label={t('residents.appointments.doneTag')} wrapClassName="span-all" />}
            </div>
            <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button><button type="submit" className="btn primary">{t('common.save')}</button></div>
          </ActionForm>
        )}
      </Dialog>
    </>
  )
}
