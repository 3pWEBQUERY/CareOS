'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/toast'
import { CheckboxGroup, Combobox, DateField, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'
import { endTaskTemplateAction, resumeTaskTemplateAction, saveTaskTemplateAction } from '@/app/(app)/tasks/actions'
import { RHYTHMS, WEEK_ORDER, type Rhythm, type TemplateDto } from '@/lib/recurrence'

export type SeriesPerson = { id: string; name: string; room: string | null; unitId: string }
export type SeriesStaff = { id: string; name: string; initials: string }

/**
 * Rhythmus-Felder (PRD §12.1): Rhythmus, «alle n», Wochentage bzw. Tag im Monat, Ende.
 * Mit `withNone` erscheint «Nicht wiederholen» (Aufgabe erstellen); weitere Felder erst nach der Wahl.
 */
export function RecurrenceFields({ withNone, defaults, startKey }: {
  withNone?: boolean
  defaults?: Partial<Pick<TemplateDto, 'rhythm' | 'every' | 'weekdays' | 'monthDay' | 'endDate'>>
  /** Startdatum YYYY-MM-DD: Vorbelegung von Wochentag und Tag im Monat */
  startKey?: string
}) {
  const t = useT()
  const [rhythm, setRhythm] = useState<Rhythm | 'none'>(defaults?.rhythm ?? (withNone ? 'none' : 'daily'))
  const start = startKey ? new Date(startKey + 'T12:00') : new Date()
  const days = t('common.weekdaysShort').split(',')
  return (
    <>
      <Select label={t('tasks.recur.repeat')} name="rhythm" value={rhythm} onChange={(e) => setRhythm(e.target.value as Rhythm | 'none')}>
        {withNone && <option value="none">{t('tasks.recur.none')}</option>}
        {RHYTHMS.map((r) => <option key={r} value={r}>{t('tasks.recur.rhythm.' + r)}</option>)}
      </Select>
      {rhythm !== 'none' && (
        <>
          <NumberField label={t('tasks.recur.every')} name="every" min={1} max={52} step={1} defaultValue={defaults?.every ?? 1} unit={t('tasks.recur.unit.' + rhythm)} required />
          {rhythm === 'weekly' && (
            <CheckboxGroup
              key={startKey}
              label={t('tasks.recur.weekdays')}
              name="weekdays"
              inline
              wrapClassName="span-all"
              hint={t('tasks.recur.weekdaysHint')}
              options={WEEK_ORDER.map((d) => ({ value: String(d), label: days[d] }))}
              defaultValue={(defaults?.weekdays?.length ? defaults.weekdays : [start.getDay()]).map(String)}
            />
          )}
          {rhythm === 'monthly' && (
            <NumberField key={startKey} label={t('tasks.recur.monthDay')} name="monthDay" min={1} max={31} step={1} defaultValue={defaults?.monthDay ?? start.getDate()} hint={t('tasks.recur.monthDayHint')} required />
          )}
          <DateField label={t('tasks.recur.end')} name="endDate" defaultValue={defaults?.endDate ?? ''} optional />
        </>
      )}
    </>
  )
}

/** Vorlage erstellen oder bearbeiten (Admin → Klinische Konfiguration, «Serie bearbeiten» in Aufgaben). */
export function TemplateDialog({ template, units, residents, staff, categories, onClose, todayKey, defaultUnitId }: {
  template?: TemplateDto
  units: { id: string; name: string }[]
  /** Vorauswahl beim Erstellen (gewählter Bereich der Topbar) */
  defaultUnitId?: string | null
  residents: SeriesPerson[]
  /** Mitarbeitende je Bereich */
  staff: Record<string, SeriesStaff[]>
  categories: string[]
  onClose: () => void
  todayKey: string
}) {
  const t = useT()
  const [unitId, setUnitId] = useState(template?.unitId ?? (units.some((u) => u.id === defaultUnitId) ? defaultUnitId! : units[0]?.id ?? ''))
  const [startKey, setStartKey] = useState(template?.startDate ?? todayKey)
  const people = residents.filter((r) => r.unitId === unitId)
  return (
    <Dialog open onClose={onClose} title={t(template ? 'tasks.recur.editTitle' : 'tasks.recur.createTitle')} wide>
      <ActionForm action={saveTaskTemplateAction} onDone={(r) => r.ok && onClose()}>
        {template && <input type="hidden" name="id" value={template.id} />}
        <div className="form-grid">
          <TextField label={t('tasks.create.titleField')} wrapClassName="span-all" name="title" required maxLength={200} defaultValue={template?.title} placeholder={t('tasks.recur.titlePh')} />
          {template || units.length < 2 ? (
            <input type="hidden" name="unitId" value={unitId} />
          ) : (
            <Select label={t('tasks.recur.unitField')} name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
          <Combobox
            key={unitId}
            label={t('tasks.col.resident')}
            optional
            name="residentId"
            defaultValue={template?.residentId ?? ''}
            placeholder={t('tasks.create.noResident')}
            options={people.map((r) => ({ value: r.id, label: r.name, hint: r.room ?? undefined }))}
          />
          <Combobox label={t('tasks.col.category')} name="category" freeText maxLength={60} defaultValue={template?.category ?? ''} placeholder={t('tasks.categoryDefault')} options={categories.map((c) => ({ value: c, label: c }))} />
          <TextField label={t('tasks.recur.times')} name="times" required defaultValue={template?.times.join(', ') ?? ''} placeholder="07:00, 19:00" hint={t('tasks.recur.timesHint')} className="mono" />
          <DateField label={t('tasks.recur.start')} name="startDate" defaultValue={startKey} onChange={(v: string) => v && setStartKey(v)} required />
          <RecurrenceFields defaults={template} startKey={startKey} />
          <NumberField label={t('tasks.details.duration')} name="durationMin" min={1} max={480} step={1} defaultValue={template?.durationMin ?? 10} unit={t('common.minutes')} />
          <Select label={t('tasks.details.priority')} name="priority" defaultValue={template?.priority ?? 'routine'}>
            {(['routine', 'important', 'critical'] as const).map((p) => <option key={p} value={p}>{t('common.priority.' + p)}</option>)}
          </Select>
          <Select key={'a' + unitId} label={t('tasks.col.assignee')} name="assigneeId" defaultValue={template?.assigneeId ?? ''}>
            <option value="">{t('tasks.unassigned')}</option>
            {(staff[unitId] ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.initials})</option>)}
          </Select>
          <Textarea label={t('tasks.create.description')} optional wrapClassName="span-all" name="description" rows={2} defaultValue={template?.description ?? ''} maxLength={2000} />
        </div>
        {template && <p className="small fg2" style={{ margin: 0 }}>{t('tasks.recur.editHint')}</p>}
        <div className="form-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <Submit>{t(template ? 'common.save' : 'common.create')}</Submit>
        </div>
      </ActionForm>
    </Dialog>
  )
}

/** Serie beenden (mit Bestätigung) bzw. wieder aufnehmen. */
export function SeriesToggle({ id, active, title, className = 'btn sm ghost', onDone }: { id: string; active: boolean; title: string; className?: string; onDone?: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const exec = async () => {
    setPending(true)
    const f = new FormData()
    f.set('id', id)
    const r = await (active ? endTaskTemplateAction(f) : resumeTaskTemplateAction(f))
    setPending(false)
    if (!r.ok) {
      if (open) setError(t(r.error))
      else toast(t(r.error), { kind: 'crit' })
      return
    }
    setOpen(false)
    if (r.message) toast(r.message)
    onDone?.()
  }
  return (
    <>
      <button type="button" className={className} disabled={pending} data-loading={(pending && !open) || undefined} onClick={() => (active ? (setError(null), setOpen(true)) : void exec())}>
        {t(active ? 'tasks.recur.endSeries' : 'tasks.recur.resume')}
      </button>
      {active && (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={() => void exec()}
          title={t('tasks.recur.endConfirm')}
          text={t('tasks.recur.endConfirmText')}
          context={<strong>{title}</strong>}
          confirmLabel={t('tasks.recur.endSeries')}
          danger
          pending={pending}
          error={error}
        />
      )}
    </>
  )
}
