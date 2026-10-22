import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { aiConfigured } from '@/lib/env'
import { addDays, dateKey, fmtDate, startOfDay } from '@/lib/time'
import { ASSESSMENTS, CARE_DOMAINS, type AssessmentDef } from '@/lib/clinical-config'
import {
  IV_CATEGORIES, assessmentLabel, categoryLabel, categoryTone, domainLabel, levelFor, suggestionKeys, weekdaysLabel, type Level,
} from '@/lib/care'
import { Empty } from '@/components/ui/Empty'
import { submissionOf } from './data'
import { EvaluateButton, IvButton, IvDeactivate, PlanAreaButton, PlanToolbar, SuggestionActions, type AreaSnapshot } from './PlanClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('residents.tabs.careplan') }
}

export default async function CarePlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const scope = { unitId: r.unitId, locationId: r.unit.locationId }
  const canEdit = ctx.can('resident.careplan.edit', scope)
  const canApprove = ctx.can('resident.careplan.approve', scope)
  const now = new Date()
  const today = startOfDay(now)

  const [domainRows, plans, assessments, defRows, wounds, decided] = await Promise.all([
    db.careDomain.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    db.carePlan.findMany({
      where: { residentId: r.id },
      orderBy: { version: 'desc' },
      include: { areas: { include: { interventions: { orderBy: { createdAt: 'asc' } } } } },
    }),
    db.assessment.findMany({ where: { residentId: r.id }, orderBy: { at: 'desc' }, take: 60 }),
    db.assessmentDefinition.findMany({ where: { orgId: ctx.org.id } }),
    db.wound.findMany({ where: { residentId: r.id, status: { not: 'closed' } }, select: { id: true, bodySite: true } }),
    db.auditLog.findMany({
      where: { orgId: ctx.org.id, entityType: 'CarePlanSuggestion', entityId: { startsWith: r.id + ':' } },
      select: { entityId: true },
    }),
  ])

  const active = plans.find((p) => p.status === 'active') ?? null
  const draft = plans.find((p) => p.status === 'draft') ?? null
  const picked = sp.v === 'draft' ? draft : sp.v ? plans.find((p) => p.id === sp.v) : null
  const plan = picked ?? active ?? draft
  const view: 'none' | 'active' | 'draft' | 'archived' = !plan ? 'none' : plan.status
  const editable = view === 'draft' && canEdit
  const submission = draft ? await submissionOf(ctx.org.id, draft.id) : null

  const userIds = [...new Set(plans.flatMap((p) => [p.createdById, p.approvedById]).concat(submission?.userId ?? null).filter((x): x is string => Boolean(x)))]
  const users = new Map((await db.user.findMany({ where: { id: { in: userIds }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, `${u.firstName} ${u.lastName}`]))

  // Pflegebereiche der Organisation, ergänzt um Standardbereiche ohne Konfiguration
  const domains = (domainRows.length ? domainRows.map((d) => ({ key: d.key, name: d.name })) : CARE_DOMAINS.map((d) => ({ key: d.key, name: d.de })))
    .map((d) => ({ value: d.key, label: domainLabel(t, d.key, d.name) }))
  const dLabel = (key: string) => domains.find((d) => d.value === key)?.label ?? domainLabel(t, key)
  const categories = IV_CATEGORIES.map((c) => ({ value: c.value, label: t('care.categories.' + c.key) }))
  const contextLabel = `${r.lastName} ${r.firstName}${r.room ? ' · ' + t('care.roomShort', { room: r.room.number }) : ''}`
  const defaultEval = dateKey(addDays(today, 30))

  const areas = plan
    ? [...plan.areas].sort((a, b) => {
        const ia = domains.findIndex((d) => d.value === a.domain)
        const ib = domains.findIndex((d) => d.value === b.domain)
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
      })
    : []
  const snapshot = (src: typeof areas): AreaSnapshot[] =>
    src.map((a) => ({
      domain: a.domain, situation: a.situation ?? '', resources: a.resources ?? '', needs: a.needs ?? '', risks: a.risks ?? '', goal: a.goal ?? '',
      evaluateBy: a.evaluateBy ? dateKey(a.evaluateBy) : '', interventions: a.interventions.map((i) => ({ title: i.title, times: i.times })),
    }))
  // Der Planungsfluss arbeitet immer auf dem Entwurf (bzw. der Kopie der aktiven Version).
  const flowAreas = snapshot((draft ?? active)?.areas ?? [])

  const ivs = areas.flatMap((a) => a.interventions)
  const wd = now.getDay()
  const minutesToday = ivs.filter((i) => i.active || view === 'draft').filter((i) => !i.weekdays.length || i.weekdays.includes(wd)).reduce((s, i) => s + i.times.length * i.durationMin, 0)
  const evalOverdue = plan?.nextEvaluation && plan.nextEvaluation < today

  // Smart Suggestions aus den letzten Assessments
  const defs = new Map<string, AssessmentDef>(ASSESSMENTS.map((a) => [a.key, a]))
  for (const d of defRows) defs.set(d.key, { key: d.key, name: d.name, description: d.description ?? '', intervalDays: d.intervalDays, items: d.items as AssessmentDef['items'] })
  const latest = new Map<string, { id: string; score: number | null; level: Level | null; at: Date }>()
  for (const a of assessments) if (!latest.has(a.key)) latest.set(a.key, { id: a.id, score: a.score, level: levelFor(defs.get(a.key), a.score), at: a.at })
  const decidedIds = new Set(decided.map((d) => d.entityId))
  const planned = new Set((draft ?? active)?.areas.flatMap((a) => a.interventions.map((i) => i.title.toLowerCase())) ?? [])
  const suggestions = view === 'archived' ? [] : suggestionKeys(latest, wounds).filter((s) => {
    if (decidedIds.has(`${r.id}:${s.rule.key}:${s.sourceId}`)) return false
    return !planned.has(t(`care.suggest.rule.${s.rule.key}.title`).toLowerCase())
  })

  const statusTag = (s: string, submitted?: boolean) =>
    s === 'active' ? <span className="tag ok">{t('care.plan.status.active')}</span>
      : s === 'draft' ? <span className={'tag ' + (submitted ? 'warn' : 'accent')}>{t(submitted ? 'care.plan.status.review' : 'care.plan.status.draft')}</span>
        : <span className="tag">{t('care.plan.status.archived')}</span>

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 className="sec">{t('care.plan.title')}</h2>
          <span className="small muted">{t('care.plan.subtitle')}</span>
        </div>
        <div className="row">
          {active && draft && (
            <nav className="seg" aria-label={t('care.plan.versions')}>
              {active && <Link href={`/residents/${r.id}/careplan`} aria-current={plan?.id === active.id ? 'page' : undefined} scroll={false}>{t('care.plan.viewActive', { v: active.version })}</Link>}
              {draft && <Link href={`/residents/${r.id}/careplan?v=draft`} aria-current={plan?.id === draft.id ? 'page' : undefined} scroll={false}>{t('care.plan.viewDraft', { v: draft.version })}</Link>}
            </nav>
          )}
          {canEdit && view !== 'archived' && (
            <PlanAreaButton
              residentId={r.id} domains={domains} categories={categories} areas={flowAreas} label={t('care.plan.planArea')}
              aiEnabled={aiConfigured() && ctx.can('ai.use')} contextLabel={contextLabel} defaultEval={defaultEval}
            />
          )}
        </div>
      </div>

      {view === 'none' ? (
        <Empty
          title={t('care.plan.none')}
          action={canEdit ? <PlanToolbar residentId={r.id} view="none" draft={null} canEdit={canEdit} canApprove={canApprove} hasActive={false} /> : undefined}
        >
          {t(canEdit ? 'care.plan.noneHint' : 'care.plan.noneHintReadonly')}
        </Empty>
      ) : (
        <>
          {view === 'active' && draft && (
            <div className="alert info">
              <span className="grow">{t('care.plan.draftBanner', { v: draft.version })}{submission ? ' · ' + t('care.plan.status.review') : ''}</span>
              <Link className="linkbtn" href={`/residents/${r.id}/careplan?v=draft`} scroll={false}>{t('care.plan.draftOpen')}</Link>
            </div>
          )}
          {view === 'draft' && (
            <div className={'alert ' + (submission ? 'warn' : 'info')}>
              <div className="grow">
                <strong>{t('care.plan.draftTitle', { v: plan!.version })}</strong>
                <span className="fg">{submission ? t('care.plan.submittedBy', { name: users.get(submission.userId ?? '') ?? '–', date: fmtDate(submission.at, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }) : t('care.plan.draftExplain')}</span>
                {!canApprove && <span className="fg"> {t('care.plan.needsApproval')}</span>}
              </div>
            </div>
          )}
          {view === 'archived' && (
            <div className="alert"><span className="grow">{t(plan!.approvedAt ? 'care.plan.archivedHint' : 'care.plan.archivedDraftHint', { v: plan!.version })}</span></div>
          )}

          <div className="metrics">
            <div className="metric">
              <span className="lbl">{t('care.plan.version')}</span>
              <span className="val">v{plan!.version} <small>{statusTag(plan!.status, view === 'draft' && Boolean(submission))}</small></span>
              <span className="small muted">{t('care.plan.createdBy', { name: users.get(plan!.createdById) ?? '–', date: fmtDate(plan!.createdAt, locale) })}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('care.plan.approvedLabel')}</span>
              {plan!.approvedAt ? (
                <>
                  <span className="val" style={{ fontSize: 15 }}>{fmtDate(plan!.approvedAt, locale)}</span>
                  <span className="small muted">{users.get(plan!.approvedById ?? '') ?? '–'}</span>
                </>
              ) : (
                <><span className="val warn" style={{ fontSize: 15 }}>–</span><span className="small muted">{t('care.plan.notApproved')}</span></>
              )}
            </div>
            <div className="metric">
              <span className="lbl">{t('care.plan.nextEval')}</span>
              <span className={'val' + (evalOverdue ? ' crit' : '')} style={{ fontSize: 15 }}>{plan!.nextEvaluation ? fmtDate(plan!.nextEvaluation, locale) : '–'}</span>
              <span className={'small ' + (evalOverdue ? 'crit-text' : 'muted')}>{evalOverdue ? '▲ ' + t('care.plan.overdue') : plan!.nextEvaluation ? t('care.plan.inDays', { n: Math.round((plan!.nextEvaluation.getTime() - today.getTime()) / 86_400_000) }) : t('care.plan.noEval')}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('care.plan.interventionsLabel')}</span>
              <span className="val">{ivs.length}</span>
              <span className="small muted">{t('care.plan.inAreas', { n: areas.length })} · {t('care.plan.minutesToday', { n: minutesToday })}</span>
            </div>
          </div>

          {(view === 'draft' || (view === 'active' && !draft)) && (canEdit || canApprove) && (
            <PlanToolbar
              residentId={r.id} view={view} canEdit={canEdit} canApprove={canApprove} hasActive={Boolean(active)}
              draft={draft ? { id: draft.id, version: draft.version, submitted: Boolean(submission) } : null}
            />
          )}
        </>
      )}

      {suggestions.length > 0 && (
        <section className="stack-sm" id="suggestions" aria-labelledby="sugg-h">
          <div className="sec-head">
            <h2 className="sec" id="sugg-h">{t('care.suggest.title')}</h2>
            <span className="small muted">{t('care.suggest.hint')}</span>
          </div>
          <ul className="list card">
            {suggestions.map((s) => {
              const title = t(`care.suggest.rule.${s.rule.key}.title`)
              const text = t(`care.suggest.rule.${s.rule.key}.text`)
              const reason = s.reason.kind === 'assessment'
                ? t('care.suggest.reasonAssessment', { name: assessmentLabel(t, s.reason.key, defs.get(s.reason.key)?.name), score: s.reason.score ?? '–' })
                : t('care.suggest.reasonWound', { site: wounds.find((w) => w.id === s.sourceId)?.bodySite ?? '' })
              return (
                <li key={s.rule.key + s.sourceId} className="li" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 220 }}>
                    <div>{title}</div>
                    <div className="small fg2">{text}</div>
                    <div className="small muted" style={{ marginTop: 2 }}>
                      <span className="tag outline">{reason}</span> {dLabel(s.rule.domain)} · <span className="mono">{s.rule.times.join(', ')}</span> · {categoryLabel(t, s.rule.category)}
                    </div>
                  </div>
                  {canEdit && (
                    <SuggestionActions
                      residentId={r.id} ruleKey={s.rule.key} sourceId={s.sourceId} domain={s.rule.domain} categories={categories} contextLabel={contextLabel}
                      iv={{ title, category: s.rule.category, times: s.rule.times.join(', '), weekdays: s.rule.weekdays, durationMin: s.rule.durationMin, instructions: text }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {plan && (
        <section className="stack" aria-label={t('care.plan.areas')}>
          {areas.length === 0 && <Empty title={t('care.plan.noAreas')}>{canEdit ? t('care.plan.noAreasHint') : null}</Empty>}
          {areas.map((a) => {
            const overdue = a.evaluateBy != null && a.evaluateBy < today
            const list = [...a.interventions].sort((x, y) => (x.times[0] ?? '').localeCompare(y.times[0] ?? ''))
            const label = dLabel(a.domain)
            return (
              <article key={a.id} className={'card' + (overdue ? ' crit' : '')} aria-labelledby={'area-' + a.id}>
                <div className="card-head">
                  <h3 id={'area-' + a.id}>{label}</h3>
                  <div className="row" style={{ gap: 6 }}>
                    {a.aiSuggested && <span className="tag violet">{t('care.plan.aiTag')}</span>}
                    {a.evaluateBy && (
                      <span className={'tag ' + (overdue ? 'crit' : 'outline')}>
                        {t('care.plan.evaluateByDate', { date: fmtDate(a.evaluateBy, locale) })}{overdue ? ' · ' + t('care.plan.overdue') : ''}
                      </span>
                    )}
                    {editable && (
                      <PlanAreaButton
                        residentId={r.id} domains={domains} categories={categories} areas={flowAreas} initialDomain={a.domain}
                        label={t('care.plan.editArea')} className="btn sm" aiEnabled={aiConfigured() && ctx.can('ai.use')} contextLabel={contextLabel} defaultEval={defaultEval}
                      />
                    )}
                  </div>
                </div>
                <div className="card-body stack-sm">
                  <dl className="kv">
                    {(['situation', 'resources', 'needs', 'risks', 'goal'] as const).map((k) => {
                      const v = a[k]
                      return (
                        <div key={k} style={{ display: 'contents' }}>
                          <dt>{t('care.plan.fields.' + k)}</dt>
                          <dd className={"ws-pre" + (k === 'risks' && v ? ' warn-text' : '')}>{v || <span className="muted">–</span>}</dd>
                        </div>
                      )
                    })}
                  </dl>

                  <div className="sec-head" style={{ marginTop: 4 }}>
                    <span className="lbl">{t('care.plan.fields.interventions')}</span>
                    {editable && (
                      <IvButton residentId={r.id} domain={a.domain} categories={categories} label={t('care.plan.addIntervention')} title={t('care.plan.addInterventionTo', { domain: label })} context={contextLabel} />
                    )}
                  </div>
                  {list.length ? (
                    <div className="tablewrap">
                      <table className="stable">
                        <thead>
                          <tr>
                            <th style={{ width: 120 }}>{t('care.plan.colTime')}</th>
                            <th>{t('care.plan.colIntervention')}</th>
                            <th style={{ width: 130 }}>{t('care.plan.colDays')}</th>
                            <th className="right" style={{ width: 90 }}>{t('care.plan.colDuration')}</th>
                            <th style={{ width: 170 }}>{t('care.plan.colCategory')}</th>
                            {editable && <th><span className="sr-only">{t('care.plan.colActions')}</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((iv) => (
                            <tr key={iv.id}>
                              <td className="num nowrap">{iv.times.join(', ')}</td>
                              <td>
                                <div style={{ fontWeight: 500 }}>{iv.title}{!iv.active && view === 'active' && <span className="tag" style={{ marginLeft: 6 }}>{t('care.plan.inactive')}</span>}</div>
                                {iv.instructions && <div className="small muted ws-pre">{iv.instructions}</div>}
                              </td>
                              <td className="nowrap">{weekdaysLabel(t, iv.weekdays)}</td>
                              <td className="num right nowrap">{iv.durationMin} {t('common.minutes')}</td>
                              <td><span className={'tag ' + categoryTone(iv.category)}>{categoryLabel(t, iv.category)}</span></td>
                              {editable && (
                                <td>
                                  <div className="row" style={{ justifyContent: 'flex-end', gap: 4, flexWrap: 'nowrap' }}>
                                  <IvButton
                                    residentId={r.id} domain={a.domain} categories={categories} label={t('common.edit')} className="btn sm ghost"
                                    title={t('care.plan.editIntervention')} context={contextLabel}
                                    iv={{ id: iv.id, title: iv.title, category: iv.category, times: iv.times.join(', '), weekdays: iv.weekdays, durationMin: iv.durationMin, instructions: iv.instructions ?? '' }}
                                  />
                                  <IvDeactivate residentId={r.id} ivId={iv.id} title={iv.title} />
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="small muted" style={{ margin: 0 }}>{t('care.plan.noInterventions')}</p>
                  )}

                  <div className="sec-head" style={{ marginTop: 4 }}>
                    <span className="lbl">{t('care.plan.fields.evaluation')}</span>
                    {canEdit && view !== 'archived' && (
                      <EvaluateButton residentId={r.id} areaId={a.id} defaultNext={defaultEval} domainLabel={label} />
                    )}
                  </div>
                  {a.evaluation ? <p className="ws-pre small" style={{ margin: 0, maxWidth: '80ch' }}>{a.evaluation}</p> : <p className="small muted" style={{ margin: 0 }}>{t('care.plan.evaluationNone')}</p>}
                </div>
              </article>
            )
          })}
        </section>
      )}

      {plans.length > 1 && (
        <section className="stack-sm" aria-labelledby="ver-h">
          <div className="sec-head"><h2 className="sec" id="ver-h">{t('care.plan.versions')}</h2></div>
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr>
                  <th>{t('care.plan.version')}</th>
                  <th>{t('care.plan.colStatus')}</th>
                  <th>{t('care.plan.colCreated')}</th>
                  <th>{t('care.plan.approvedLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="num"><Link href={`/residents/${r.id}/careplan?v=${p.status === 'draft' ? 'draft' : p.id}`} scroll={false} aria-current={plan?.id === p.id ? 'page' : undefined}>v{p.version}</Link></td>
                    <td>{statusTag(p.status, p.status === 'draft' && Boolean(submission))}</td>
                    <td className="nowrap">{fmtDate(p.createdAt, locale)} · {users.get(p.createdById) ?? '–'}</td>
                    <td className="nowrap">{p.approvedAt ? `${fmtDate(p.approvedAt, locale)} · ${users.get(p.approvedById ?? '') ?? '–'}` : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
