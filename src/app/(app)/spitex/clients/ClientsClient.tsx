'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { Checkbox, CheckboxGroup, DateField, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'
import { ActButton } from '@/app/(app)/team/_ui/ActButton'
import { WEEK_ORDER } from '@/lib/recurrence'
import { endTemplateAction, saveClientAction, saveTemplateAction } from '../actions'
import { ServiceRows, type ServiceDto } from '../_ui/ServiceRows'

export type TemplateDto = {
  id: string; weekdays: number[]; start: string; end: string; preferredUserId: string | null; startDate: string; endDate: string | null; note: string | null
  services: ServiceDto[]
}
export type ClientDto = { id: string; name: string; street: string | null; postalCode: string | null; city: string | null; phone: string | null; hasAccess: boolean }

function Actions({ onClose, label }: { onClose: () => void; label: string }) {
  const t = useT()
  return (
    <div className="form-actions">
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
      <button type="submit" className="btn primary">{label}</button>
    </div>
  )
}

/** Einsatzort, Telefon und Zugang (Türcode, Schlüsselbox) der Person. */
export function ClientButton({ c }: { c: ClientDto }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [clear, setClear] = useState(false)
  const close = () => { setOpen(false); setClear(false) }
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)} aria-label={t('spitex.clients.editNamed', { name: c.name })}>{t('spitex.clients.edit')}</button>
      {open && (
        <Dialog open onClose={close} title={t('spitex.clients.editTitle')} context={<strong>{c.name}</strong>}>
          <ActionForm action={saveClientAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="residentId" value={c.id} />
            <div className="form-grid">
              <TextField label={t('spitex.clients.street')} optional name="street" defaultValue={c.street ?? ''} maxLength={120} autoComplete="off" wrapClassName="span-all" />
              <TextField label={t('spitex.clients.postalCode')} optional name="postalCode" defaultValue={c.postalCode ?? ''} maxLength={10} inputMode="numeric" autoComplete="off" />
              <TextField label={t('spitex.clients.city')} optional name="city" defaultValue={c.city ?? ''} maxLength={80} autoComplete="off" />
              <TextField label={t('spitex.clients.phone')} optional name="phone" defaultValue={c.phone ?? ''} maxLength={40} type="tel" autoComplete="off" wrapClassName="span-all" />
              {!clear && (
                <Textarea label={t('spitex.access.title')} optional name="accessNote" rows={2} maxLength={500} wrapClassName="span-all"
                  hint={t(c.hasAccess ? 'spitex.access.keepHint' : 'spitex.access.newHint')} />
              )}
              {c.hasAccess && <Checkbox name="clearAccess" label={t('spitex.access.clear')} checked={clear} onChange={(e) => setClear(e.currentTarget.checked)} wrapClassName="span-all" />}
            </div>
            <Actions onClose={close} label={t('spitex.form.save')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Wochenvorlage anlegen oder ändern. */
export function TemplateButton({ clientId, clientName, staff, today, tpl, className = 'btn sm' }: {
  clientId: string
  clientName: string
  staff: { id: string; label: string }[]
  today: string
  tpl?: TemplateDto
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const days = t('common.weekdaysShort').split(',')
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={t(tpl ? 'spitex.templates.editNamed' : 'spitex.templates.newNamed', { name: clientName })}>
        {t(tpl ? 'spitex.templates.edit' : 'spitex.templates.new')}
      </button>
      {open && (
        <Dialog open onClose={close} title={t(tpl ? 'spitex.templates.editTitle' : 'spitex.templates.newTitle')} context={<strong>{clientName}</strong>} wide>
          <ActionForm action={saveTemplateAction} onDone={(r) => r.ok && close()}>
            <input type="hidden" name="id" value={tpl?.id ?? ''} />
            <input type="hidden" name="residentId" value={clientId} />
            <div className="form-grid">
              <CheckboxGroup label={t('spitex.templates.weekdays')} name="weekdays" inline wrapClassName="span-all"
                options={WEEK_ORDER.map((d) => ({ value: String(d), label: days[d] }))} defaultValue={(tpl?.weekdays ?? [1, 2, 3, 4, 5]).map(String)} />
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-end' }}>
                <TimeField label={t('spitex.form.start')} name="start" defaultValue={tpl?.start} step={300} quick={false} required wrapStyle={{ flex: 1, minWidth: 0 }} />
                <TimeField label={t('spitex.form.end')} name="end" defaultValue={tpl?.end} step={300} quick={false} required wrapStyle={{ flex: 1, minWidth: 0 }} />
              </div>
              <Select label={t('spitex.templates.preferred')} name="preferredUserId" defaultValue={tpl?.preferredUserId ?? ''} hint={t('spitex.templates.preferredHint')}>
                <option value="">{t('spitex.unassigned')}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
              <DateField label={t('spitex.templates.from')} name="startDate" defaultValue={tpl?.startDate ?? today} required />
              <DateField label={t('spitex.templates.until')} name="endDate" defaultValue={tpl?.endDate ?? ''} min={today} optional />
              <ServiceRows initial={tpl?.services} />
              <Textarea label={t('spitex.form.note')} optional name="note" rows={2} maxLength={500} defaultValue={tpl?.note ?? ''} wrapClassName="span-all" hint={t('spitex.templates.noteHint')} />
            </div>
            {tpl && <p className="small muted" style={{ margin: 0 }}>{t('spitex.templates.regenerateHint')}</p>}
            <Actions onClose={close} label={t('spitex.form.save')} />
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

export function EndTemplateButton({ id, label }: { id: string; label: string }) {
  const t = useT()
  return <ActButton className="btn sm danger" action={() => endTemplateAction(id)} confirm="spitex.confirm.endTemplate" title={t('spitex.templates.endNamed', { label })}>{t('spitex.templates.end')}</ActButton>
}
