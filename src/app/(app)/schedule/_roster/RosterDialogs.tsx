'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Combobox, DateField, NumberField, RadioGroup, TextField, Textarea } from '@/components/ui/fields'
import { savePensumAction, startProposalAction } from '../roster-actions'
import type { RDay, RPersonRow, RTypeOpt } from './types'

/** Vorschlag erstellen: mit KI (Anweisungen), automatisch oder aus dem Vormonat. */
export function PlanDialog({ source, onClose, unitId, month, defaultMode, model }: {
  source: 'ai' | 'auto' | 'copy'
  onClose: () => void
  unitId: string
  month: string
  defaultMode: 'fill' | 'replace'
  model: string
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
            <p className="small muted" style={{ margin: 0 }}>{t('roster.dialog.privacy')} {t('roster.dialog.model', { model })}</p>
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

/** Pensum einer Person (Grundlage der Soll-Stunden). */
export function PersonDialog({ person, unitId, onClose }: { person: RPersonRow; unitId: string; onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open onClose={onClose} title={person.name}>
      <ActionForm action={(f) => savePensumAction(unitId, person.id, Number(String(f.get('pct') ?? '').replace(',', '.')))} onDone={(r) => r.ok && onClose()} reset={false}>
        <NumberField label={t('roster.person.pensum')} name="pct" unit="%" min={5} max={100} step={5} defaultValue={person.pct} required hint={t('roster.person.pensumHint')} />
        <div className="form-actions">
          <Submit>{t('common.save')}</Submit>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </ActionForm>
    </Dialog>
  )
}
