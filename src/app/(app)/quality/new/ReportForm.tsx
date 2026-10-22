'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { reportIncidentAction } from '../actions'

type Step = { key: string; title: string; offsetMin: number }
type TypeOpt = { id: string; key: string; name: string; steps: Step[] }
type ResOpt = { id: string; name: string; room: string | null; age: number; unitId: string; unitName: string; risks: string[] }

const KNOWN_STEPS = ['vitals', 'assessment', 'physician', 'careplan', 'followup', 'wound', 'debrief']
const SEVERITIES = ['none', 'minor', 'moderate', 'severe'] as const
/** Felder, die im eingeklappten Bereich «Zeitpunkt, Ort, Bereich» liegen. */
const DETAIL_FIELDS = ['occurredAt', 'place', 'unitId', 'nearMiss']

/**
 * Ereignis melden (PRD §22, §48): das Wesentliche auf einem Bildschirm – Typ, Person, Beschreibung,
 * Sofortmassnahmen, Schweregrad. Zeitpunkt (vorbelegt: jetzt), Ort und Bereich sind eingeklappt,
 * die Zusammenfassung zeigt die Vorbelegung. Der Folgeprozess erscheint vor dem Absenden.
 */
export function ReportForm({ now, nowLabel, types, residents, units, defaultUnitId, defaultResidentId }: {
  now: string
  nowLabel: string
  types: TypeOpt[]
  residents: ResOpt[]
  units: { id: string; name: string }[]
  defaultUnitId: string
  defaultResidentId: string
}) {
  const t = useT()
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  const details = useRef<HTMLDetailsElement>(null)
  const [typeId, setTypeId] = useState('')
  const [residentId, setResidentId] = useState(defaultResidentId)
  const [unitId, setUnitId] = useState(defaultUnitId)
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('none')
  const [when, setWhen] = useState(now)
  const [place, setPlace] = useState('')
  const [error, setError] = useState<{ msg: string; field?: string } | null>(null)
  const [pending, start] = useTransition()

  const type = types.find((x) => x.id === typeId)
  const resident = residents.find((r) => r.id === residentId)
  const unitName = resident?.unitName ?? units.find((u) => u.id === unitId)?.name ?? ''
  const byUnit = useMemo(() => {
    const m = new Map<string, ResOpt[]>()
    for (const r of residents) m.set(r.unitName, [...(m.get(r.unitName) ?? []), r])
    return [...m.entries()]
  }, [residents])

  const stepTitle = (s: Step) => (KNOWN_STEPS.includes(s.key) ? t('quality.workflow.' + s.key) : s.title)
  const offset = (min: number) => (min < 60 ? `+${min} ${t('common.minutes')}` : `+${Math.round(min / 60)} h`)
  const whenLabel = (() => {
    if (when === now) return nowLabel
    const [d = '', tm = ''] = when.split('T')
    const [y, m, dd] = d.split('-')
    return y ? `${dd}.${m}.${y} ${tm}` : '–'
  })()
  const invalid = (f: string) => error?.field === f || undefined

  function fail(msg: string, field?: string) {
    setError({ msg: /^[a-z]+\.[\w.]+$/.test(msg) ? t(msg) : msg, field })
    if (!field) return
    if (DETAIL_FIELDS.includes(field) && details.current) details.current.open = true
    requestAnimationFrame(() => (ref.current?.querySelector(`[name="${field}"], [data-field="${field}"]`) as HTMLElement | null)?.focus())
  }

  function submit() {
    const form = ref.current!
    const fd = new FormData(form)
    if (!fd.get('typeId')) return fail('quality.errors.type', 'typeId')
    if (!fd.get('occurredAt')) return fail('quality.errors.occurredAt', 'occurredAt')
    if (new Date(String(fd.get('occurredAt'))).getTime() > Date.now() + 5 * 60_000) return fail('quality.errors.future', 'occurredAt')
    if (String(fd.get('description') ?? '').trim().length < 3) return fail('quality.errors.description', 'description')
    setError(null)
    start(async () => {
      const r = await reportIncidentAction(fd)
      if (r.ok && r.data) {
        toast(t('quality.report.done'))
        router.push(`/quality/${r.data.id}?new=1`)
      } else if (!r.ok) {
        fail(r.error, r.field)
      }
    })
  }

  return (
    <form ref={ref} className="form q-report" noValidate aria-busy={pending || undefined} onSubmit={(e) => { e.preventDefault(); submit() }}>
      <fieldset disabled={pending} className="q-report-body">
        <fieldset className="q-sec">
          <legend className="lbl">{t('quality.fields.type')}</legend>
          <input type="hidden" name="typeId" value={typeId} />
          <div className="chips q-types" role="radiogroup" aria-label={t('quality.fields.type')} aria-invalid={invalid('typeId')} aria-describedby={invalid('typeId') ? 'q-err' : undefined}>
            {types.map((x, i) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                data-field={i === 0 ? 'typeId' : undefined}
                aria-checked={typeId === x.id}
                aria-pressed={typeId === x.id}
                className="chip"
                onClick={() => { setTypeId(x.id); if (error?.field === 'typeId') setError(null) }}
              >
                {x.name}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="fld">
          <span className="lbl">{t('quality.fields.resident')} <span className="muted">({t('common.optional')})</span></span>
          <select className="field" name="residentId" value={residentId} onChange={(e) => setResidentId(e.target.value)}>
            <option value="">{t('quality.report.noResident')}</option>
            {byUnit.map(([u, list]) => (
              <optgroup key={u} label={u}>
                {list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` · ${r.room}` : ''}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {resident && <input type="hidden" name="unitId" value={resident.unitId} />}
        {resident && (
          <div className="dlg-context q-ctx" aria-live="polite">
            <span className="grow"><strong>{resident.name}</strong>{resident.room && <> · <span className="mono">{t('quality.report.room')} {resident.room}</span></>} · {resident.age} {t('common.years')} · {resident.unitName}</span>
            {resident.risks.length > 0 && <span className="small">{resident.risks.join(', ')}</span>}
          </div>
        )}

        <label className="fld">
          <span className="lbl">{t('quality.report.what')}</span>
          <textarea className="field" name="description" rows={3} required maxLength={5000} placeholder={t('quality.report.descriptionHint')} aria-invalid={invalid('description')} aria-describedby={invalid('description') ? 'q-err' : undefined} />
        </label>

        <div className="fld">
          <span className="lbl" id="sev-l">{t('quality.fields.severity')}</span>
          <input type="hidden" name="severity" value={severity} />
          <div className="seg q-sev" role="radiogroup" aria-labelledby="sev-l" aria-describedby="sev-h">
            {SEVERITIES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={severity === s} aria-pressed={severity === s} onClick={() => setSeverity(s)}>
                {t('quality.severity.' + s)}
              </button>
            ))}
          </div>
          <span className="hint" id="sev-h">{t('quality.severityHint.' + severity)}</span>
        </div>
        {(severity === 'severe' || severity === 'moderate') && (
          <div className="alert warn" role="status"><span className="grow">{t('quality.report.severeHint')}</span></div>
        )}

        <label className="fld">
          <span className="lbl">{t('quality.fields.immediateActions')} <span className="muted">({t('common.optional')})</span></span>
          <textarea className="field" name="immediateActions" rows={2} maxLength={5000} placeholder={t('quality.report.immediateHint')} />
        </label>

        <details ref={details} className="q-details">
          <summary>
            <span className="lbl">{t('quality.ux.details')}</span>
            <span className="small q-details-sum">
              <span className="mono">{whenLabel}</span>
              {place && <> · {place}</>}
              {' · '}{unitName}
            </span>
            <span className="linkbtn small">{t('quality.ux.change')}</span>
          </summary>
          <div className="form-grid q-details-body">
            <label className="fld">
              <span className="lbl">{t('quality.fields.occurredAt')}</span>
              <input className="field mono" type="datetime-local" name="occurredAt" value={when} onChange={(e) => setWhen(e.target.value)} max={now.slice(0, 10) + 'T23:59'} required aria-invalid={invalid('occurredAt')} aria-describedby={invalid('occurredAt') ? 'q-err' : undefined} />
            </label>
            <label className="fld">
              <span className="lbl">{t('quality.fields.place')}</span>
              <input className="field" name="place" list="q-places" maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} placeholder={resident?.room ? `${t('quality.report.room')} ${resident.room}` : ''} />
              <datalist id="q-places">
                {['room', 'bathroom', 'corridor', 'common', 'outdoor'].map((k) => <option key={k} value={k === 'room' && resident?.room ? `${t('quality.report.room')} ${resident.room}` : t('quality.places.' + k)} />)}
              </datalist>
            </label>
            {!resident && (
              <label className="fld">
                <span className="lbl">{t('quality.fields.unit')}</span>
                <select className="field" name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            <label className="check" style={{ alignSelf: 'end', minHeight: 34 }}>
              <input type="checkbox" name="nearMiss" />
              <span>{t('quality.fields.nearMiss')} <span className="small muted">– {t('quality.report.nearMissHint')}</span></span>
            </label>
          </div>
        </details>

        <section className="q-next" aria-labelledby="q-next-h" aria-live="polite">
          <h2 className="lbl" id="q-next-h">{t('quality.ux.afterSubmit')}</h2>
          {type ? (
            type.steps.length ? (
              <ol className="q-next-list">
                {type.steps.map((s) => <li key={s.key}><span className="grow">{stepTitle(s)}</span> <span className="mono small muted nowrap">{offset(s.offsetMin)}</span></li>)}
              </ol>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('quality.report.noWorkflow')}</p>
          ) : <p className="small muted" style={{ margin: 0 }}>{t('quality.ux.pickType')}</p>}
          <p className="small muted" style={{ margin: 0 }}>
            {resident ? t('quality.report.alsoChart') + ' ' : ''}{t('quality.report.notifyLeads')}
          </p>
        </section>
      </fieldset>

      {error && <p className="err" id="q-err" role="alert" style={{ margin: 0 }}>{error.msg}</p>}
      <div className="form-actions q-submit">
        <button type="submit" className="btn primary lg" data-loading={pending || undefined} disabled={pending}>{t('quality.report.cta')}</button>
        <span className="small muted q-submit-ctx">{resident ? `${resident.name}${resident.room ? ' · ' + resident.room : ''}` : t('quality.report.noResidentContext', { unit: unitName })}</span>
      </div>
    </form>
  )
}
