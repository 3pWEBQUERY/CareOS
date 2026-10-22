import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { orgSettings } from '@/lib/admin'
import { FEATURE_FLAGS } from '@/lib/admin-shared'
import { VITALS, VITAL_KEYS } from '@/lib/vitals'
import type { AssessmentDef, WorkflowStep } from '@/lib/clinical-config'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn, FormDialog } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { WorkflowEditor } from './WorkflowEditor'
import { Escalations } from './Escalations'
import { Acks } from './Acks'
import {
  deleteShiftTypeAction, resetThresholdAction, saveAssessmentAction, saveCoverageAction, saveDomainsAction,
  saveFlagsAction, saveIncidentTypeAction, saveShiftTypeAction, saveThresholdsAction,
} from './actions'
import { TimeField } from '@/components/ui/TimeField'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.config')} · ${t('nav.admin')}` }
}

const TABS = ['domains', 'assessments', 'vitals', 'incidents', 'shifts', 'features', 'escalations', 'acks'] as const
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
        {TABS.map((k) => <Link key={k} href={`/admin/config?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{t('admin.config.tabs.' + k)}</Link>)}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'domains' && <Domains />}
          {tab === 'assessments' && <Assessments />}
          {tab === 'vitals' && <Vitals />}
          {tab === 'incidents' && <Incidents />}
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
                <td style={{ width: 90 }}><input className="field mono" type="number" min={0} max={999} name={'order:' + r.id} defaultValue={r.order} aria-label={t('admin.config.order')} /></td>
                <td><input className="field" name={'name:' + r.id} defaultValue={r.name} maxLength={80} aria-label={t('admin.config.name')} style={{ minWidth: 200 }} /></td>
                <td><code className="mono small muted">{r.key}</code></td>
                <td><label className="check"><input type="checkbox" name={'active:' + r.id} defaultChecked={r.active} /><span className="small">{t('admin.config.active')}</span></label></td>
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
  const defs = await db.assessmentDefinition.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } })
  if (!defs.length) return <Empty title={t('admin.config.noAssessments')} />
  return (
    <div className="stack">
      <p className="fg2" style={{ margin: 0 }}>{t('admin.config.assessmentsHint')}</p>
      {defs.map((d) => {
        const items = d.items as unknown as AssessmentDef['items']
        return (
          <section key={d.id} className="card">
            <div className="card-head">
              <div><h3>{d.name}</h3>{d.description && <span className="small muted">{d.description}</span>}</div>
              {d.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}
            </div>
            <div className="card-body stack-sm">
              <ActionForm action={saveAssessmentAction} reset={false} success="common.saved" className="row">
                <input type="hidden" name="id" value={d.id} />
                <label className="fld" style={{ minWidth: 200 }}><span className="lbl">{t('admin.config.name')}</span><input className="field" name="name" defaultValue={d.name} maxLength={80} /></label>
                <label className="fld" style={{ width: 150 }}><span className="lbl">{t('admin.config.intervalDays')}</span><input className="field mono" type="number" min={1} max={730} name="intervalDays" defaultValue={d.intervalDays ?? ''} placeholder="–" /></label>
                <label className="check" style={{ alignSelf: 'flex-end', minHeight: 34 }}><input type="checkbox" name="active" defaultChecked={d.active} /><span>{t('admin.config.active')}</span></label>
                <div style={{ alignSelf: 'flex-end' }}><Submit className="btn">{t('common.save')}</Submit></div>
              </ActionForm>
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
              const step = v.dec ? '0.1' : '1'
              return (
                <tr key={k}>
                  <th scope="row">{t('common.vitals.' + k)}</th>
                  <td className="mono small muted">{v.unit}</td>
                  <td style={{ width: 110 }}><input className="field mono" type="number" step={step} name={'lo:' + k} defaultValue={row?.lo ?? v.lo} aria-label={`${t('common.vitals.' + k)} ${t('admin.config.lo')}`} /></td>
                  <td style={{ width: 110 }}><input className="field mono" type="number" step={step} name={'hi:' + k} defaultValue={row?.hi ?? v.hi} aria-label={`${t('common.vitals.' + k)} ${t('admin.config.hi')}`} /></td>
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
        <label className="fld"><span className="lbl">{t('admin.config.name')}</span><input className="field" name="name" defaultValue={it?.name} required maxLength={80} /></label>
        <label className="check" style={{ alignSelf: 'flex-end', minHeight: 34 }}><input type="checkbox" name="active" defaultChecked={it?.active ?? true} /><span>{t('admin.config.active')}</span></label>
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
      <label className="fld"><span className="lbl">{t('admin.config.code')}</span><input className="field mono" name="code" defaultValue={st?.code} required maxLength={4} /></label>
      <label className="fld"><span className="lbl">{t('admin.config.name')}</span><input className="field" name="name" defaultValue={st?.name} required maxLength={60} /></label>
      <label className="fld"><span className="lbl">{t('admin.config.start')}</span><TimeField name="start" defaultValue={st?.start ?? '07:00'} required /></label>
      <label className="fld"><span className="lbl">{t('admin.config.end')}</span><TimeField name="end" defaultValue={st?.end ?? '15:30'} required /></label>
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
            <thead><tr><th>{t('admin.config.code')}</th><th>{t('admin.config.name')}</th><th>{t('admin.config.start')}</th><th>{t('admin.config.end')}</th><th className="right">{t('admin.config.planned')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
            <tbody>
              {types.map((st) => (
                <tr key={st.id}>
                  <th scope="row"><span className={'sh ' + st.code}>{st.code}</span></th>
                  <td>{st.name}</td>
                  <td className="num">{st.start}</td>
                  <td className="num">{st.end}</td>
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
              <label key={st.id} className="fld" style={{ width: 130 }}>
                <span className="lbl">{st.code} · {st.name}</span>
                <input className="field mono" type="number" min={0} max={50} name={'cov:' + st.code} defaultValue={coverage[st.code] ?? ''} placeholder="–" />
              </label>
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
  const flags = await db.featureFlag.findMany({ where: { orgId: ctx.org.id } })
  return (
    <ActionForm action={saveFlagsAction} reset={false} success="common.saved">
      <p className="fg2" style={{ margin: 0 }}>{t('admin.config.featuresHint')}</p>
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
        {FEATURE_FLAGS.map((k) => (
          <li key={k}>
            <label className="li" style={{ cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" name={'flag:' + k} defaultChecked={flags.find((f) => f.key === k)?.enabled ?? false} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
              <div className="grow"><div>{t('admin.config.flags.' + k)}</div><div className="small muted">{t('admin.config.flags.' + k + 'Hint')}</div></div>
              <code className="mono small muted">{k}</code>
            </label>
          </li>
        ))}
      </ul>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
