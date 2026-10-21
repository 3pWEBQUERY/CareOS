'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { toast } from '@/components/toast'
import { reportIncidentAction } from '../actions'

type Step = { key: string; title: string; offsetMin: number }
type TypeOpt = { id: string; key: string; name: string; steps: Step[] }
type ResOpt = { id: string; name: string; room: string | null; age: number; unitId: string; unitName: string; risks: string[] }

const KNOWN_STEPS = ['vitals', 'assessment', 'physician', 'careplan', 'followup', 'wound', 'debrief']
const SEVERITIES = ['none', 'minor', 'moderate', 'severe'] as const

export function ReportForm({ now, types, residents, units, defaultUnitId, defaultResidentId }: {
  now: string
  types: TypeOpt[]
  residents: ResOpt[]
  units: { id: string; name: string }[]
  defaultUnitId: string
  defaultResidentId: string
}) {
  const t = useT()
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  const [typeId, setTypeId] = useState('')
  const [residentId, setResidentId] = useState(defaultResidentId)
  const [unitId, setUnitId] = useState(defaultUnitId)
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>('none')
  const [confirm, setConfirm] = useState<FormData | null>(null)
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

  const context = resident ? (
    <span><strong>{resident.name}</strong>{resident.room && <> · <span className="mono">{t('quality.report.room')} {resident.room}</span></>} · {resident.age} {t('common.years')} · {resident.unitName}</span>
  ) : (
    <span>{t('quality.report.noResidentContext', { unit: unitName })}</span>
  )

  function check(): boolean {
    const form = ref.current!
    const fd = new FormData(form)
    const fail = (msg: string, field: string) => {
      setError({ msg: t(msg), field })
      ;(form.querySelector(`[name="${field}"]`) as HTMLElement | null)?.focus()
      return false
    }
    if (!fd.get('typeId')) return fail('quality.errors.type', 'typeId')
    if (!fd.get('occurredAt')) return fail('quality.errors.occurredAt', 'occurredAt')
    if (new Date(String(fd.get('occurredAt'))).getTime() > Date.now() + 5 * 60_000) return fail('quality.errors.future', 'occurredAt')
    if (String(fd.get('description') ?? '').trim().length < 3) return fail('quality.errors.description', 'description')
    setError(null)
    setConfirm(fd)
    return true
  }

  function submit() {
    if (!confirm) return
    const fd = confirm
    start(async () => {
      const r = await reportIncidentAction(fd)
      if (r.ok && r.data) {
        setConfirm(null)
        toast(t('quality.report.done'))
        router.push(`/quality/${r.data.id}`)
      } else if (!r.ok) {
        setConfirm(null)
        setError({ msg: /^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error, field: r.field })
      }
    })
  }

  return (
    <>
      <form ref={ref} className="form" noValidate onSubmit={(e) => { e.preventDefault(); check() }}>
        <fieldset>
          <legend className="lbl">{t('quality.fields.type')}</legend>
          <input type="hidden" name="typeId" value={typeId} />
          <div className="chips" role="radiogroup" aria-label={t('quality.fields.type')} style={{ paddingTop: 4 }}>
            {types.map((x) => (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={typeId === x.id}
                aria-pressed={typeId === x.id}
                className="chip"
                style={{ minHeight: 36 }}
                onClick={() => setTypeId(x.id)}
              >
                {x.name}
              </button>
            ))}
          </div>
          {type && (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              {type.steps.length
                ? <>{t('quality.report.workflowPreview')}: {type.steps.map((s) => `${stepTitle(s)} (${offset(s.offsetMin)})`).join(' · ')}</>
                : t('quality.report.noWorkflow')}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="lbl">{t('quality.report.whoWhere')}</legend>
          <div className="form-grid" style={{ paddingTop: 4 }}>
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
            {!resident && (
              <label className="fld">
                <span className="lbl">{t('quality.fields.unit')}</span>
                <select className="field" name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            {resident && <input type="hidden" name="unitId" value={resident.unitId} />}
            <label className="fld">
              <span className="lbl">{t('quality.fields.occurredAt')}</span>
              <input className="field mono" type="datetime-local" name="occurredAt" defaultValue={now} max={now.slice(0, 10) + 'T23:59'} required aria-invalid={error?.field === 'occurredAt' || undefined} />
            </label>
            <label className="fld">
              <span className="lbl">{t('quality.fields.place')}</span>
              <input className="field" name="place" list="q-places" maxLength={200} placeholder={resident?.room ? `${t('quality.report.room')} ${resident.room}` : ''} />
              <datalist id="q-places">
                {['room', 'bathroom', 'corridor', 'common', 'outdoor'].map((k) => <option key={k} value={k === 'room' && resident?.room ? `${t('quality.report.room')} ${resident.room}` : t('quality.places.' + k)} />)}
              </datalist>
            </label>
          </div>
          {resident && (
            <div className="dlg-context" style={{ marginTop: 12 }} aria-live="polite">
              {context}
              {resident.risks.length > 0 && <span className="small" style={{ marginLeft: 'auto' }}>{resident.risks.join(', ')}</span>}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="lbl">{t('quality.report.what')}</legend>
          <div className="stack-sm" style={{ paddingTop: 4 }}>
            <label className="fld">
              <span className="lbl">{t('quality.fields.description')}</span>
              <textarea className="field" name="description" required maxLength={5000} placeholder={t('quality.report.descriptionHint')} aria-invalid={error?.field === 'description' || undefined} />
            </label>
            <label className="fld">
              <span className="lbl">{t('quality.fields.immediateActions')}</span>
              <textarea className="field" name="immediateActions" maxLength={5000} placeholder={t('quality.report.immediateHint')} style={{ minHeight: 64 }} />
            </label>
            <div className="form-grid">
              <div className="fld">
                <span className="lbl" id="sev-l">{t('quality.fields.severity')}</span>
                <input type="hidden" name="severity" value={severity} />
                <div className="seg" role="radiogroup" aria-labelledby="sev-l" style={{ alignSelf: 'start' }}>
                  {SEVERITIES.map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={severity === s} aria-pressed={severity === s} onClick={() => setSeverity(s)} style={{ minHeight: 34 }}>
                      {t('quality.severity.' + s)}
                    </button>
                  ))}
                </div>
                <span className="hint">{t('quality.severityHint.' + severity)}</span>
              </div>
              <label className="check" style={{ alignSelf: 'center' }}>
                <input type="checkbox" name="nearMiss" />
                <span>{t('quality.fields.nearMiss')} <span className="small muted">– {t('quality.report.nearMissHint')}</span></span>
              </label>
            </div>
          </div>
        </fieldset>

        {(severity === 'severe' || severity === 'moderate') && (
          <div className="alert warn"><span className="grow">{t('quality.report.severeHint')}</span></div>
        )}
        {error && <p className="err" role="alert" style={{ margin: 0 }}>{error.msg}</p>}
        <div className="form-actions">
          <button type="submit" className="btn primary lg">{t('quality.report.review')}</button>
          <span className="small muted">{t('quality.report.reviewHint')}</span>
        </div>
      </form>

      <Dialog
        open={!!confirm}
        onClose={() => !pending && setConfirm(null)}
        title={t('quality.report.confirmTitle')}
        context={context}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(null)} disabled={pending}>{t('common.back')}</button>
            <button type="button" className="btn primary" onClick={submit} data-loading={pending || undefined} disabled={pending}>{t('quality.report.confirm')}</button>
          </>
        }
      >
        {confirm && (
          <dl className="kv">
            <dt>{t('quality.fields.type')}</dt><dd>{type?.name}</dd>
            <dt>{t('quality.fields.occurredAt')}</dt><dd className="mono">{String(confirm.get('occurredAt')).replace('T', ' ')}</dd>
            {String(confirm.get('place') ?? '') && <><dt>{t('quality.fields.place')}</dt><dd>{String(confirm.get('place'))}</dd></>}
            <dt>{t('quality.fields.severity')}</dt><dd>{t('quality.severity.' + severity)}{confirm.get('nearMiss') ? ' · ' + t('quality.nearMiss') : ''}</dd>
            <dt>{t('quality.fields.description')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{String(confirm.get('description'))}</dd>
            <dt>{t('quality.report.followup')}</dt>
            <dd>
              {type?.steps.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {type.steps.map((s) => <li key={s.key}>{stepTitle(s)} <span className="muted mono small">{offset(s.offsetMin)}</span></li>)}
                </ul>
              ) : t('quality.report.noWorkflow')}
              <div className="small muted" style={{ marginTop: 4 }}>
                {resident ? t('quality.report.alsoChart') : null} {t('quality.report.notifyLeads')}
              </div>
            </dd>
          </dl>
        )}
      </Dialog>
    </>
  )
}
