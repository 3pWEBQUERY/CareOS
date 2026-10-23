import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { orgSettings } from '@/lib/admin'
import { MODULES, MODULE_PACKAGES } from '@/lib/modules'
import { saveModulesAction } from './module-actions'
import { VITALS, VITAL_KEYS } from '@/lib/vitals'
import type { AssessmentDef, WorkflowStep } from '@/lib/clinical-config'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { WorkflowEditor } from './WorkflowEditor'
import { Escalations } from './Escalations'
import { Acks } from './Acks'
import { Workflows } from './Workflows'
import { Recurring } from './Recurring'
import { FocusRules } from './FocusRules'
import { CustomVitalsEditor } from '@/components/residents/CustomVitalsEditor'
import { customVitals } from '@/lib/vitals-custom'
import { AssessmentBuilderButton, type BuilderValue } from './AssessmentBuilder'
import { ASSESSMENTS } from '@/lib/clinical-config'
import {
  deleteShiftTypeAction, resetThresholdAction, saveAssessmentAction, saveCoverageAction, saveDomainsAction,
  saveIncidentTypeAction, saveShiftTypeAction, saveThresholdsAction,
} from './actions'
import { Checkbox, NumberField, Select, Switch, TextField, TimeField } from '@/components/ui/fields'
import { SHIFT_COLORS } from '@/lib/shift-types'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.config')} · ${t('nav.admin')}` }
}

const TABS = ['domains', 'assessments', 'vitals', 'customVitals', 'incidents', 'focus', 'workflows', 'recurring', 'shifts', 'features', 'escalations', 'acks'] as const
/** Reiter aus Paket «Aufgaben/Workflows»: Beschriftung im Namespace tasks. */
const TAB_KEYS: Partial<Record<(typeof TABS)[number], string>> = { workflows: 'tasks.rules.tab', recurring: 'tasks.recur.admin.tab', features: 'tenancy.modules.tab' }
type Tab = (typeof TABS)[number]

export default async function ConfigPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.config')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'domains'
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.config')} sub={t('admin.config.sub')} />
      <nav className="tabs" aria-label={t('admin.nav.config')}>
        {TABS.map((k) => <Link key={k} href={`/admin/config?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{t(TAB_KEYS[k] ?? 'admin.config.tabs.' + k)}</Link>)}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'domains' && <Domains />}
          {tab === 'assessments' && <Assessments />}
          {tab === 'vitals' && <Vitals />}
          {tab === 'customVitals' && <CustomVitalsEditor defs={customVitals(ctx.org.settings)} />}
          {tab === 'incidents' && <Incidents />}
          {tab === 'focus' && <FocusRules />}
          {tab === 'workflows' && <Workflows />}
          {tab === 'recurring' && <Recurring />}
          {tab === 'shifts' && <Shifts />}
          {tab === 'features' && <Features />}
          {tab === 'escalations' && <Escalations />}
          {tab === 'acks' && <Acks />}
        </div>
      </div>
    </main>
  )
}

async function Domains() {
  const ctx = await getCtx()
  const { t } = ctx
  const rows = await db.careDomain.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ order: 'asc' }, { name: 'asc' }] })
  if (!rows.length) return <Empty title={t('admin.config.noDomains')} />
  return (
    <ActionForm action={saveDomainsAction} reset={false} success="common.saved">
      <p className="fg2" style={{ margin: 0 }}>{t('admin.config.domainsHint')}</p>
      <div className="tablewrap">
        <table className="stable">
          <thead><tr><th>{t('admin.config.order')}</th><th>{t('admin.config.name')}</th><th>{t('admin.config.key')}</th><th>{t('admin.config.active')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ width: 90 }}><NumberField min={0} max={999} name={'order:' + r.id} defaultValue={r.order} aria-label={t('admin.config.order')} step={1} /></td>
                <td><TextField name={'name:' + r.id} defaultValue={r.name} maxLength={80} aria-label={t('admin.config.name')} style={{ minWidth: 200 }} /></td>
                <td><code className="mono small muted">{r.key}</code></td>
                <td><Checkbox name={'active:' + r.id} defaultChecked={r.active} label={t('admin.config.active')} wrapClassName="small" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}

async function Assessments() {
  const ctx = await getCtx()
  const { t } = ctx
  const [defs, usage] = await Promise.all([
    db.assessmentDefinition.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } }),
    db.assessment.groupBy({ by: ['key'], where: { resident: { orgId: ctx.org.id } }, _count: true }),
  ])
  const std = new Set(ASSESSMENTS.map((a) => a.key))
  const usedN = (key: string) => usage.find((u) => u.key === key)?._count ?? 0
  const create = <AssessmentBuilderButton label={t('forms.assessment.add')} />
  if (!defs.length) return <div className="stack"><div className="row-between"><Empty title={t('admin.config.noAssessments')} />{create}</div></div>
  return (
    <div className="stack">
      <div className="row-between">
        <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('admin.config.assessmentsHint')} {t('forms.assessment.hint')}</p>
        {create}
      </div>
      {defs.map((d) => {
        const items = d.items as unknown as AssessmentDef['items']
        const custom = !std.has(d.key)
        const n = usedN(d.key)
        const value: BuilderValue = { id: d.id, name: d.name, description: d.description ?? '', intervalDays: d.intervalDays, questions: (items?.questions ?? []).map((q) => ({ label: q.label, options: q.options.map((o) => ({ label: o.label, v: o.v })) })), ranges: items?.ranges ?? [] }
        return (
          <section key={d.id} className="card">
            <div className="card-head">
              <div><h3>{d.name}</h3>{d.description && <span className="small muted">{d.description}</span>}</div>
              <div className="row" style={{ gap: 6 }}>
                <span className="tag outline">{t(custom ? 'forms.assessment.custom' : 'forms.assessment.standard')}</span>
                {d.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}
              </div>
            </div>
            <div className="card-body stack-sm">
              <ActionForm action={saveAssessmentAction} reset={false} success="common.saved" className="row">
                <input type="hidden" name="id" value={d.id} />
                <TextField label={t('admin.config.name')} wrapStyle={{ minWidth: 200 }} name="name" defaultValue={d.name} maxLength={80} />
                <NumberField label={t('admin.config.intervalDays')} wrapStyle={{ width: 150 }} min={1} max={730} name="intervalDays" defaultValue={d.intervalDays ?? ''} placeholder="–" step={1} />
                <Checkbox name="active" defaultChecked={d.active} label={t('admin.config.active')} wrapStyle={{ alignSelf: 'flex-end', minHeight: 34 }} />
                <div style={{ alignSelf: 'flex-end' }}><Submit className="btn">{t('common.save')}</Submit></div>
              </ActionForm>
              {custom && (
                <div className="row" style={{ gap: 8 }}>
                  {n === 0 ? <AssessmentBuilderButton initial={value} label={t('forms.assessment.editItems')} buttonClass="btn sm ghost" /> : <span className="small muted">{t('forms.assessment.lockedHint', { n })}</span>}
                  <AssessmentBuilderButton initial={{ ...value, id: undefined, name: t('forms.assessment.copyName', { name: d.name }) }} label={t('forms.assessment.copy')} buttonClass="btn sm ghost" />
                </div>
              )}
              <details>
                <summary className="linkbtn small" style={{ cursor: 'pointer' }}>{t('admin.config.viewItems', { n: items?.questions?.length ?? 0 })}</summary>
                <div className="grid-2" style={{ marginTop: 10 }}>
                  <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
                    {items?.questions?.map((q) => (
                      <li key={q.key} style={{ marginBottom: 6 }}>
                        <strong style={{ fontWeight: 500 }}>{q.label}</strong>
                        <div className="muted">{q.options.map((o) => `${o.v} = ${o.label}`).join(' · ')}</div>
                      </li>
                    ))}
                  </ol>
                  <div className="tablewrap">
                    <table className="stable">
                      <thead><tr><th>{t('admin.config.range')}</th><th>{t('admin.config.result')}</th></tr></thead>
                      <tbody>
                        {items?.ranges?.map((r) => (
                          <tr key={r.min}><td className="num">{r.min}–{r.max}</td><td><span className={'tag ' + (r.level === 'crit' ? 'crit' : r.level === 'warn' ? 'warn' : 'ok')}>{r.result}</span></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </div>
          </section>
        )
      })}
    </div>
  )
}

async function Vitals() {
  const ctx = await getCtx()
  const { t } = ctx
  const rows = await db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, residentId: null } })
  const individual = await db.vitalThreshold.count({ where: { orgId: ctx.org.id, residentId: { not: null } } })
  return (
    <ActionForm action={saveThresholdsAction} reset={false} success="common.saved">
      <p className="fg2" style={{ margin: 0 }}>{t('admin.config.vitalsHint', { n: individual })}</p>
      <div className="tablewrap">
        <table className="stable">
          <thead><tr><th>{t('admin.config.parameter')}</th><th>{t('admin.config.unit')}</th><th>{t('admin.config.lo')}</th><th>{t('admin.config.hi')}</th><th>{t('admin.config.plausible')}</th><th>{t('admin.config.source')}</th></tr></thead>
          <tbody>
            {VITAL_KEYS.map((k) => {
              const v = VITALS[k]
              const row = rows.find((r) => r.key === k)
              const step = v.dec ? 0.1 : 1
              return (
                <tr key={k}>
                  <th scope="row">{t('common.vitals.' + k)}</th>
                  <td className="mono small muted">{v.unit}</td>
                  <td style={{ width: 110 }}><NumberField step={step} name={'lo:' + k} defaultValue={row?.lo ?? v.lo} aria-label={`${t('common.vitals.' + k)} ${t('admin.config.lo')}`} /></td>
                  <td style={{ width: 110 }}><NumberField step={step} name={'hi:' + k} defaultValue={row?.hi ?? v.hi} aria-label={`${t('common.vitals.' + k)} ${t('admin.config.hi')}`} /></td>
                  <td className="mono small muted nowrap">{v.min}–{v.max}</td>
                  <td>{row ? (
                    <span className="row" style={{ gap: 6 }}><span className="tag accent">{t('admin.config.orgValue')}</span><ActBtn action={resetThresholdAction.bind(null, k)} className="linkbtn small">{t('admin.config.resetDefault')}</ActBtn></span>
                  ) : <span className="tag outline">{t('admin.config.default')}</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}

async function Incidents() {
  const ctx = await getCtx()
  const { t } = ctx
  const types = await db.incidentType.findMany({ where: { orgId: ctx.org.id }, include: { _count: { select: { incidents: true } } }, orderBy: { name: 'asc' } })
  const fields = (it?: (typeof types)[number]) => (
    <>
      {it && <input type="hidden" name="id" value={it.id} />}
      <div className="form-grid">
        <TextField label={t('admin.config.name')} name="name" defaultValue={it?.name} required maxLength={80} />
        <Checkbox name="active" defaultChecked={it?.active ?? true} label={t('admin.config.active')} wrapStyle={{ alignSelf: 'flex-end', minHeight: 34 }} />
      </div>
      <WorkflowEditor initial={((it?.workflow ?? []) as unknown as WorkflowStep[]).map((s) => ({ key: s.key ?? '', title: s.title ?? '', category: s.category ?? '', offsetMin: Number(s.offsetMin) || 0, durationMin: Number(s.durationMin) || 10 }))} />
    </>
  )
  return (
    <div className="stack">
      <div className="row-between">
        <p className="fg2" style={{ margin: 0 }}>{t('admin.config.incidentsHint')}</p>
        <FormDialog label={t('admin.config.addIncidentType')} buttonClass="btn sm" title={t('admin.config.addIncidentType')} action={saveIncidentTypeAction} submit={t('common.save')} success="common.saved" wide>{fields()}</FormDialog>
      </div>
      <div className="tablewrap">
        <table className="stable">
          <thead><tr><th>{t('admin.config.name')}</th><th>{t('admin.config.key')}</th><th>{t('admin.config.workflow')}</th><th className="right">{t('admin.config.reports')}</th><th>{t('admin.config.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
          <tbody>
            {types.map((it) => {
              const wf = (it.workflow ?? []) as unknown as WorkflowStep[]
              return (
                <tr key={it.id}>
                  <th scope="row">{it.name}</th>
                  <td><code className="mono small muted">{it.key}</code></td>
                  <td className="small">{wf.length ? wf.map((s) => s.title).join(' → ') : <span className="muted">{t('admin.config.noSteps')}</span>}</td>
                  <td className="num right">{it._count.incidents}</td>
                  <td>{it.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}</td>
                  <td className="right"><FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={it.name} action={saveIncidentTypeAction} submit={t('common.save')} success="common.saved" wide>{fields(it)}</FormDialog></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

async function Shifts() {
  const ctx = await getCtx()
  const { t } = ctx
  const types = await db.shiftType.findMany({ where: { orgId: ctx.org.id }, include: { _count: { select: { shifts: true } } }, orderBy: { start: 'asc' } })
  const coverage = orgSettings(ctx.org.settings).coverage ?? {}
  const fields = (st?: (typeof types)[number]) => (
    <div className="form-grid">
      {st && <input type="hidden" name="id" value={st.id} />}
      <TextField label={t('admin.config.code')} name="code" defaultValue={st?.code} required maxLength={4} className="mono" />
      <TextField label={t('admin.config.name')} name="name" defaultValue={st?.name} required maxLength={60} />
      <TimeField label={t('admin.config.start')} name="start" defaultValue={st?.start ?? '07:00'} required />
      <TimeField label={t('admin.config.end')} name="end" defaultValue={st?.end ?? '15:30'} required />
      <NumberField label={t('admin.config.breakMinutes')} name="breakMinutes" unit="min" min={0} max={240} step={5} defaultValue={st?.breakMinutes ?? 0} />
      <Select label={t('roster.types.color')} name="color" defaultValue={st?.color ?? 'accent'}>
        {SHIFT_COLORS.map((c) => <option key={c} value={c}>{t('roster.types.colors.' + c)}</option>)}
      </Select>
    </div>
  )
  return (
    <div className="stack">
      <section className="stack-sm" aria-labelledby="c-shift">
        <div className="sec-head">
          <h2 className="sec" id="c-shift">{t('admin.config.shiftTypes')}</h2>
          <FormDialog label={t('admin.config.addShiftType')} buttonClass="btn sm" title={t('admin.config.addShiftType')} action={saveShiftTypeAction} submit={t('common.save')} success="common.saved">{fields()}</FormDialog>
        </div>
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('admin.config.code')}</th><th>{t('admin.config.name')}</th><th>{t('admin.config.start')}</th><th>{t('admin.config.end')}</th><th className="right">{t('admin.config.breakMinutes')}</th><th className="right">{t('admin.config.planned')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
            <tbody>
              {types.map((st) => (
                <tr key={st.id}>
                  <th scope="row"><span className={'sh ' + st.code}>{st.code}</span></th>
                  <td>{st.name}</td>
                  <td className="num">{st.start}</td>
                  <td className="num">{st.end}</td>
                  <td className="num right">{st.breakMinutes} min</td>
                  <td className="num right">{st._count.shifts}</td>
                  <td className="right nowrap">
                    <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={st.name} action={saveShiftTypeAction} submit={t('common.save')} success="common.saved">{fields(st)}</FormDialog>
                    {st._count.shifts === 0 && <ActBtn action={deleteShiftTypeAction.bind(null, st.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<strong>{st.name}</strong>}>{t('common.delete')}</ActBtn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="c-cov">
        <div className="card-head"><h2 id="c-cov">{t('admin.config.coverage')}</h2><span className="small muted">{t('admin.config.coverageHint')}</span></div>
        <div className="card-body">
          <ActionForm action={saveCoverageAction} reset={false} success="common.saved" className="row">
            {types.map((st) => (
              <NumberField key={st.id} label={<>{st.code} · {st.name}</>} wrapStyle={{ width: 130 }} min={0} max={50} name={'cov:' + st.code} defaultValue={coverage[st.code] ?? ''} placeholder="–" step={1} />
            ))}
            <div style={{ alignSelf: 'flex-end' }}><Submit className="btn">{t('common.save')}</Submit></div>
          </ActionForm>
        </div>
      </section>
    </div>
  )
}

async function Features() {
  const ctx = await getCtx()
  const { t } = ctx
  // Module je Organisation (PRD §69): wirken zentral über die Berechtigungen (src/lib/modules.ts, getCtx)
  return (
    <ActionForm action={saveModulesAction} reset={false} success="tenancy.modules.saved">
      <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('tenancy.modules.hint')}</p>
      <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>{t('tenancy.modules.core')}</p>
      {MODULE_PACKAGES.map((pkg) => (
        <section key={pkg} aria-labelledby={'mod-' + pkg}>
          <h2 className="sec" id={'mod-' + pkg}>{t('tenancy.modules.pkg.' + pkg)}</h2>
          <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
            {MODULES.filter((m) => m.pkg === pkg).map((m) => (
              <li key={m.key}>
                <div className="li">
                  <Switch name={'module:' + m.key} defaultChecked={ctx.modules.includes(m.key)} label={t('tenancy.modules.items.' + m.key + '.name')} hint={t('tenancy.modules.items.' + m.key + '.hint')} wrapClassName="grow" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
