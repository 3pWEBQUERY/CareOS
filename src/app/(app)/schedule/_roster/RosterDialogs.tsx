'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { CheckboxGroup, Combobox, DateField, NumberField, RadioGroup, Select, TextField, Textarea, TimeField } from '@/components/ui/fields'
import { SHIFT_COLORS } from '@/lib/shift-types'
import { ActButton } from '../../team/_ui/ActButton'
import { deleteRosterShiftTypeAction, savePersonPlanAction, saveRosterShiftTypeAction, startProposalAction } from '../roster-actions'
import type { RDay, RPersonRow, RTypeOpt } from './types'

/** Vorschlag erstellen: mit KI (Anweisungen), automatisch oder aus dem Vormonat. */
export function PlanDialog({ source, onClose, unitId, month, defaultMode }: {
  source: 'ai' | 'auto' | 'copy'
  onClose: () => void
  unitId: string
  month: string
  defaultMode: 'fill' | 'replace'
}) {
  const t = useT()
  return (
    <Dialog open onClose={onClose} title={t(`roster.dialog.${source}Title`)}>
      <ActionForm action={startProposalAction} onDone={(r) => r.ok && onClose()} reset={false}>
        <input type="hidden" name="unitId" value={unitId} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="source" value={source} />
        {source !== 'ai' && <p className="small fg2" style={{ margin: 0 }}>{t(source === 'auto' ? 'roster.dialog.autoBody' : 'roster.dialog.copyBody')}</p>}
        <RadioGroup label={t('roster.dialog.mode')} name="mode" defaultValue={defaultMode} options={[
          { value: 'fill', label: t('roster.dialog.fill'), hint: t('roster.dialog.fillHint') },
          { value: 'replace', label: t('roster.dialog.replace'), hint: t('roster.dialog.replaceHint') },
        ]} />
        {source === 'ai' && (
          <>
            <Textarea label={t('roster.dialog.instructions')} name="instructions" optional rows={4} maxLength={2000} counter hint={t('roster.dialog.instructionsHint')} />
            <p className="small muted" style={{ margin: 0 }}>{t('roster.dialog.privacy')}</p>
          </>
        )}
        <p className="small muted" style={{ margin: 0 }}>{t('roster.dialog.result')}</p>
        <div className="form-actions">
          <Submit>{t('roster.dialog.start')}</Submit>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </ActionForm>
    </Dialog>
  )
}

/** Muster (Rhythmus) für eine Person über einen Zeitraum eintragen – im Raster, mit «Rückgängig». */
export function PatternDialog({ onClose, onApply, people, days, types, monthLabel, initial }: {
  onClose: () => void
  onApply: (cells: { user: string; day: string; code: string | null }[]) => number
  people: RPersonRow[]
  days: RDay[]
  types: RTypeOpt[]
  monthLabel: string
  initial?: { userId?: string; day?: string }
}) {
  const t = useT()
  const [error, setError] = useState<{ field: string; text: string } | null>(null)
  const first = days.find((d) => !d.past)?.key ?? days[0]?.key
  const codes = new Set(types.map((x) => x.code))
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const user = String(f.get('userId') ?? '')
    const from = String(f.get('from') ?? '')
    const to = String(f.get('to') ?? '')
    const tokens = String(f.get('pattern') ?? '').trim().toUpperCase().split(/[\s,;]+/).filter(Boolean)
    if (!people.some((p) => p.id === user)) return setError({ field: 'userId', text: t('schedule.errors.person') })
    const inMonth = days.filter((d) => d.key >= from && d.key <= to)
    if (!from || !to || to < from || !inMonth.length || from < days[0].key || to > days[days.length - 1].key) return setError({ field: 'to', text: t('roster.pattern.range', { month: monthLabel }) })
    const bad = tokens.find((x) => x !== '-' && x !== 'X' && !codes.has(x))
    if (!tokens.length || bad) return setError({ field: 'pattern', text: t('roster.pattern.invalid', { code: bad ?? '' }) })
    const cells = inMonth.map((d, i) => {
      const v = tokens[i % tokens.length]
      return { user, day: d.key, code: v === '-' || (v === 'X' && !codes.has('X')) ? null : v }
    })
    const n = onApply(cells)
    toast(t('roster.pattern.applied', { n }))
    onClose()
  }
  return (
    <Dialog open onClose={onClose} title={t('roster.pattern.title')}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Combobox label={t('roster.pattern.person')} wrapClassName="span-all" name="userId" defaultValue={initial?.userId ?? ''} required
            options={people.map((p) => ({ value: p.id, label: p.name, hint: `${p.pct} % · ${p.qual || p.job}` }))} error={error?.field === 'userId' ? error.text : undefined} />
          <DateField label={t('roster.pattern.from')} name="from" defaultValue={initial?.day && initial.day >= (first ?? '') ? initial.day : first} required />
          <DateField label={t('roster.pattern.to')} name="to" defaultValue={days[days.length - 1]?.key} required error={error?.field === 'to' ? error.text : undefined} />
          <TextField label={t('roster.pattern.pattern')} wrapClassName="span-all" name="pattern" required className="mono" placeholder="F F S S - - N N - -" hint={t('roster.pattern.patternHint')} error={error?.field === 'pattern' ? error.text : undefined} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('roster.pattern.skip')}</p>
        <div className="form-actions">
          <button type="submit" className="btn primary">{t('roster.pattern.apply')}</button>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </Dialog>
  )
}

/** Pensum und dauerhafte Vorgaben einer Person (Grundlage für Soll-Stunden und Planung). */
export function PersonDialog({ person, unitId, types, onClose }: { person: RPersonRow; unitId: string; types: RTypeOpt[]; onClose: () => void }) {
  const t = useT()
  const opts = types.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))
  return (
    <Dialog open onClose={onClose} title={person.name}>
      <ActionForm action={(f) => savePersonPlanAction(unitId, person.id, f)} onDone={(r) => r.ok && onClose()} reset={false}>
        <div className="form-grid">
          <NumberField label={t('roster.person.pensum')} name="pct" unit="%" min={5} max={100} step={5} defaultValue={person.pct} required hint={t('roster.person.pensumHint')} />
          <NumberField label={t('roster.person.maxNights')} name="maxNights" min={0} max={31} step={1} defaultValue={person.maxNights ?? ''} hint={t('roster.person.maxNightsHint')} />
        </div>
        <CheckboxGroup label={t('roster.person.allowed')} name="allowed" options={opts} defaultValue={person.allowed} hint={t('roster.person.allowedHint')} inline optional />
        <CheckboxGroup label={t('roster.person.preferred')} name="preferred" options={opts} defaultValue={person.preferred} hint={t('roster.person.preferredHint')} inline optional />
        <div className="form-actions">
          <Submit>{t('common.save')}</Submit>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </ActionForm>
    </Dialog>
  )
}

/** Dienstarten verwalten: eigene Dienste (z. B. «Stübli») mit Zeit, Pause, Farbe, Soll-Besetzung und Wochentagen. */
export function ShiftTypesDialog({ onClose, types, weekdays }: { onClose: () => void; types: RTypeOpt[]; weekdays: { n: number; label: string }[] }) {
  const t = useT()
  const [edit, setEdit] = useState<RTypeOpt | 'new' | null>(null)
  const daysLabel = (d: number[]) => (d.length === 7 ? t('roster.types.everyDay') : weekdays.filter((w) => d.includes(w.n)).map((w) => w.label).join(', '))
  if (edit) {
    const x = edit === 'new' ? null : edit
    return (
      <Dialog open onClose={() => setEdit(null)} title={t(x ? 'roster.types.edit' : 'roster.types.add')}>
        <ActionForm action={saveRosterShiftTypeAction} onDone={(r) => r.ok && setEdit(null)} reset={false}>
          {x && <input type="hidden" name="id" value={x.id} />}
          <div className="form-grid">
            <TextField label={t('roster.types.code')} name="code" defaultValue={x?.code} required maxLength={4} className="mono" placeholder="ST" />
            <TextField label={t('roster.types.name')} name="name" defaultValue={x?.rawName} required maxLength={60} placeholder="Stübli" />
            <TimeField label={t('roster.types.start')} name="start" defaultValue={x?.start ?? '09:00'} required />
            <TimeField label={t('roster.types.end')} name="end" defaultValue={x?.end ?? '17:00'} required />
            <NumberField label={t('roster.types.breakMinutes')} name="breakMinutes" unit="min" min={0} max={240} step={5} defaultValue={x?.breakMinutes ?? 0} />
            <Select label={t('roster.types.color')} name="color" defaultValue={x?.color ?? 'ok'}>
              {SHIFT_COLORS.map((c) => <option key={c} value={c}>{t('roster.types.colors.' + c)}</option>)}
            </Select>
            <NumberField label={t('roster.types.target')} name="target" min={0} max={50} step={1} defaultValue={x?.target ?? 1} required hint={t('roster.types.targetHint')} />
          </div>
          <CheckboxGroup label={t('roster.types.days')} name="days" inline options={weekdays.map((w) => ({ value: String(w.n), label: w.label }))} defaultValue={(x?.days ?? [1, 2, 3, 4, 5]).map(String)} />
          <div className="form-actions">
            <Submit>{t('common.save')}</Submit>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
            <span className="spacer" />
            {x && !x.inUse && (
              <ActButton action={async () => { const r = await deleteRosterShiftTypeAction(x.id); if (r.ok) setEdit(null); return r }} className="btn ghost danger" confirm="admin.common.deleteConfirm">{t('common.delete')}</ActButton>
            )}
          </div>
          {x?.inUse && <p className="small muted" style={{ margin: 0 }}>{t('roster.types.inUse')}</p>}
        </ActionForm>
      </Dialog>
    )
  }
  return (
    <Dialog open onClose={onClose} title={t('roster.types.title')} wide>
      <p className="small fg2" style={{ marginTop: 0 }}>{t('roster.types.hint')}</p>
      <ul className="rst-types">
        {types.map((x) => (
          <li key={x.id}>
            <span className={'sh ' + (['F', 'S', 'N'].includes(x.code) ? x.code : 'col-' + x.color)}>{x.code}</span>
            <span className="grow">
              <strong>{x.name}</strong>
              <span className="small muted"> · {x.start}–{x.end} · {x.hours} h · {t('roster.types.perDay', { n: x.target })} · {daysLabel(x.days)}</span>
            </span>
            <button type="button" className="btn sm ghost" onClick={() => setEdit(x)}>{t('common.edit')}</button>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={() => setEdit('new')}>{t('roster.types.add')}</button>
        <button type="button" className="btn ghost" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Dialog>
  )
}
