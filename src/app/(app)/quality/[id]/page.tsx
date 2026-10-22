import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { IncidentStage } from '@prisma/client'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { age, fmtDate, fmtRel, hm } from '@/lib/time'
import { addActionAction, saveStageAction } from '../actions'
import { ActionCheck } from '../client'
import { actionTitle, canManageUnit, qualityUnits, SEVERITIES, STAGES, stageIndex, toLocalInput } from '../_lib'
import { StageForm } from './StageForm'

export const metadata = { title: 'Quality' }

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const { id } = await params
  const sp = await searchParams
  const units = qualityUnits(ctx)
  const inc = await db.incident.findFirst({
    where: { id, orgId: ctx.org.id, unitId: { in: units.map((u) => u.id) } },
    include: {
      type: true,
      unit: { include: { location: true } },
      resident: { include: { room: true } },
      actions: { orderBy: [{ dueAt: 'asc' }] },
    },
  })
  if (!inc) notFound()
  const now = new Date()
  const scope = { unitId: inc.unitId, locationId: inc.unit.locationId }
  const canReport = ctx.can('quality.report', scope)
  const canManage = canManageUnit(ctx, inc.unit)
  const canSeeResident = inc.resident ? ctx.can('resident.read', scope) : false
  const closed = inc.stage === 'closed'

  // Erledigt-Status mit verknüpften Aufgaben abgleichen (Aufgabe ist führend)
  const taskIds = inc.actions.map((a) => a.taskId).filter((x): x is string => !!x)
  const tasks = taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } } }) : []
  const taskById = new Map(tasks.map((k) => [k.id, k]))
  const actions = await Promise.all(
    inc.actions.map(async (a) => {
      const task = a.taskId ? taskById.get(a.taskId) : undefined
      if (!task) return { ...a, done: a.doneAt != null, task }
      const done = task.status === 'done' || task.status === 'partial'
      if (done && !a.doneAt) {
        await db.incidentAction.update({ where: { id: a.id }, data: { doneAt: task.completedAt ?? now, doneById: task.completedById } })
        return { ...a, done, doneAt: task.completedAt ?? now, doneById: task.completedById, task }
      }
      if (!done && a.doneAt) {
        await db.incidentAction.update({ where: { id: a.id }, data: { doneAt: null, doneById: null } })
        return { ...a, done, doneAt: null, doneById: null, task }
      }
      return { ...a, done, task }
    }),
  )
  const openActions = actions.filter((a) => !a.done).length

  const audits = await db.auditLog.findMany({
    where: {
      orgId: ctx.org.id,
      OR: [
        { entityType: 'incident', entityId: inc.id },
        { entityType: 'incident_action', context: { path: ['incidentId'], equals: inc.id } },
      ],
    },
    orderBy: { at: 'desc' },
    take: 100,
  })
  const userIds = [...new Set([inc.reportedById, inc.closedById, ...actions.map((a) => a.doneById), ...audits.map((a) => a.userId)].filter((x): x is string => !!x))]
  const users = await db.user.findMany({ where: { id: { in: userIds }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })
  const uname = (uid: string | null | undefined) => {
    const u = users.find((x) => x.id === uid)
    return u ? `${u.firstName} ${u.lastName}` : '–'
  }
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)

  const current = closed ? 5 : stageIndex(inc.stage)
  const view: IncidentStage = (STAGES as string[]).includes(String(sp.s)) ? (sp.s as IncidentStage) : inc.stage
  const vi = stageIndex(view)
  const MANAGE_NEXT: IncidentStage[] = ['assessment', 'analysis']
  const nextLabel = (s: IncidentStage) => t('quality.detail.advanceTo', { stage: t('quality.stages.' + STAGES[stageIndex(s) + 1]) })
  const isCurrent = view === inc.stage && !closed
  const sevTone = inc.severity === 'severe' ? 'crit' : inc.severity === 'moderate' ? 'warn' : ''
  const who = inc.resident ? (canSeeResident ? `${inc.resident.lastName} ${inc.resident.firstName}` : t('quality.list.residentHidden')) : inc.unit.name
  const dlgContext = <span>{inc.type.name} · <strong>{who}</strong> · <span className="mono">{fmtDate(inc.occurredAt, locale)} {hm(inc.occurredAt)}</span></span>
  const justReported = sp.new === '1' && !closed
  const chartEntry = !!inc.resident

  const stageBody = () => {
    const save = saveStageAction.bind(null, inc.id, view)
    switch (view) {
      case 'reported':
        return (
          <>
            <dl className="kv">
              <dt>{t('quality.fields.type')}</dt><dd>{inc.type.name}{inc.nearMiss && <span className="tag outline" style={{ marginLeft: 6 }}>{t('quality.nearMiss')}</span>}</dd>
              <dt>{t('quality.fields.occurredAt')}</dt><dd className="mono">{fmtDate(inc.occurredAt, locale)} {hm(inc.occurredAt)}</dd>
              <dt>{t('quality.fields.place')}</dt><dd>{inc.place || '–'}</dd>
              <dt>{t('quality.fields.severity')}</dt><dd><span className={'tag ' + sevTone}>{t('quality.severity.' + inc.severity)}</span></dd>
              <dt>{t('quality.fields.description')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{inc.description}</dd>
              <dt>{t('quality.detail.reportedBy')}</dt><dd>{uname(inc.reportedById)} · <span className="mono small">{rel(inc.createdAt)}</span></dd>
            </dl>
            {isCurrent && canReport && (
              <StageForm action={save} canSave={false} advanceLabel={nextLabel('reported')}><span /></StageForm>
            )}
          </>
        )
      case 'immediate':
        return !closed && canReport ? (
          <StageForm action={save} advanceLabel={isCurrent ? nextLabel('immediate') : undefined} canAdvance={canManage}>
            <label className="fld"><span className="lbl">{t('quality.fields.immediateActions')}</span>
              <textarea className="field" name="immediateActions" defaultValue={inc.immediateActions ?? ''} maxLength={5000} placeholder={t('quality.report.immediateHint')} />
            </label>
            {isCurrent && !canManage && <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.manageNext')}</p>}
          </StageForm>
        ) : <ReadText label={t('quality.fields.immediateActions')} text={inc.immediateActions} empty={t('quality.detail.notRecorded')} />
      case 'assessment':
        return !closed && canManage ? (
          <StageForm action={save} advanceLabel={isCurrent ? nextLabel('assessment') : undefined}>
            <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.assessmentHint')}</p>
            <label className="fld"><span className="lbl">{t('quality.fields.assessment')}</span>
              <textarea className="field" name="assessment" defaultValue={inc.assessment ?? ''} maxLength={5000} />
            </label>
            <label className="fld" style={{ maxWidth: 260 }}><span className="lbl">{t('quality.fields.severity')}</span>
              <select className="field" name="severity" defaultValue={inc.severity}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{t('quality.severity.' + s)}</option>)}
              </select>
            </label>
          </StageForm>
        ) : <ReadText label={t('quality.fields.assessment')} text={inc.assessment} empty={canManage || closed ? t('quality.detail.notRecorded') : t('quality.detail.manageOnly')} />
      case 'followup':
        return (
          <>
            <p className="small fg2" style={{ margin: 0 }}>{t('quality.detail.followupHint', { open: openActions, total: actions.length })}</p>
            {!closed && canManage && isCurrent && (
              <StageForm action={save} canSave={false} advanceLabel={nextLabel('followup')} context={dlgContext} confirmTitle={t('quality.ux.analysisTitle')} confirmAdvance={openActions ? t('quality.ux.analysisOpen', { n: openActions }) : undefined}><span /></StageForm>
            )}
          </>
        )
      case 'analysis':
        return !closed && canManage ? (
          <StageForm action={save}>
            <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.analysisHint')}</p>
            <label className="fld"><span className="lbl">{t('quality.fields.analysis')}</span>
              <textarea className="field" name="analysis" defaultValue={inc.analysis ?? ''} maxLength={8000} style={{ minHeight: 120 }} />
            </label>
            {isCurrent && <Link className="linkbtn small" href={`/quality/${inc.id}?s=closed`}>{t('quality.detail.toClose')} →</Link>}
          </StageForm>
        ) : <ReadText label={t('quality.fields.analysis')} text={inc.analysis} empty={canManage || closed ? t('quality.detail.notRecorded') : t('quality.detail.manageOnly')} />
      case 'closed':
        return closed ? (
          <>
            <ReadText label={t('quality.fields.conclusion')} text={inc.conclusion} empty={t('quality.detail.notRecorded')} />
            <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.closedBy', { name: uname(inc.closedById), at: inc.closedAt ? `${fmtDate(inc.closedAt, locale)} ${hm(inc.closedAt)}` : '–' })}</p>
          </>
        ) : canManage ? (
          <StageForm action={save} advanceLabel={t('quality.detail.close')} context={dlgContext} confirmTitle={t('quality.ux.closeTitle')} confirmAdvance={t('quality.ux.closeFinal')} consequences={openActions ? [t('quality.ux.closeOpen', { n: openActions })] : undefined}>
            <label className="fld"><span className="lbl">{t('quality.fields.conclusion')}</span>
              <textarea className="field" name="conclusion" defaultValue={inc.conclusion ?? ''} maxLength={5000} placeholder={t('quality.detail.conclusionHint')} />
            </label>
            {openActions > 0 && <div className="alert warn"><span className="grow">{t('quality.detail.openActionsWarn', { n: openActions })}</span></div>}
          </StageForm>
        ) : <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.manageOnly')}</p>
    }
  }

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <span className="lbl"><Link href="/quality" style={{ color: 'inherit', textDecoration: 'none' }}>CareOS Quality</Link> · {inc.unit.name}</span>
          <h1>{inc.type.name} <span className="muted" style={{ fontWeight: 400 }}>· {who}</span></h1>
          <p className="sub"><span className="mono">{fmtDate(inc.occurredAt, locale)} {hm(inc.occurredAt)}</span>{inc.place ? ` · ${inc.place}` : ''}</p>
        </div>
        <div className="row">
          <span className={'tag ' + sevTone}>{t('quality.severity.' + inc.severity)}</span>
          {inc.nearMiss && <span className="tag outline">{t('quality.nearMiss')}</span>}
          <span className={'tag ' + (closed ? 'ok' : 'accent')}>{t('quality.stages.' + inc.stage)}</span>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {justReported && (
            <div className="alert ok q-done" role="status">
              <span className="grow">
                <strong>{t('quality.ux.created')}</strong>
                <span className="fg"> {t('quality.ux.createdTasks', { n: actions.length })}{chartEntry ? ' ' + t('quality.ux.createdChart') : ''} {t('quality.ux.createdLeads')}</span>
              </span>
              {actions.some((a) => a.task) && <Link className="btn sm" href="/tasks">{t('quality.ux.toTasks')}</Link>}
            </div>
          )}
          <ol className="steps q-steps" aria-label={t('quality.detail.workflow')}>
            {STAGES.map((s, i) => {
              const state = i < current || closed ? 'done' : i === current ? 'current' : 'todo'
              return (
                <li key={s} data-state={state} data-view={view === s || undefined}>
                  <Link href={`/quality/${inc.id}?s=${s}`} aria-current={view === s ? 'step' : undefined} scroll={false}>
                    <span className="n">{state === 'done' ? '✓ ' : state === 'current' ? '● ' : ''}{i + 1}</span>
                    <span className="q-step-name">{t('quality.stages.' + s)}</span>
                    <span className="sr-only">, {t(state === 'done' ? 'quality.detail.stageDone' : state === 'current' ? 'quality.detail.stageCurrent' : 'quality.detail.stageTodo')}</span>
                  </Link>
                </li>
              )
            })}
          </ol>
          {!closed && (
            <p className="small fg2 q-nextstep" style={{ margin: 0 }}>
              <span className="lbl">{t('quality.ux.nextStep')}</span> {t('quality.ux.next.' + inc.stage)}
              {!canManage && MANAGE_NEXT.includes(inc.stage) && <span className="muted"> · {t('quality.detail.manageOnly')}</span>}
            </p>
          )}

          {inc.resident && canSeeResident && (
            <div className="dlg-context">
              <span className="grow"><strong>{inc.resident.lastName} {inc.resident.firstName}</strong>{inc.resident.room && <> · <span className="mono">{inc.resident.room.number}</span></>} · {age(inc.resident.birthDate)} {t('common.years')}</span>
              <Link className="linkbtn small" href={`/residents/${inc.resident.id}`}>{t('quality.detail.openChart')}</Link>
            </div>
          )}

          <div className="grid-2 q-detail" data-new={justReported || undefined}>
            <div className="stack">
            <section className="card q-o1" aria-labelledby="stage-h">
              <div className="card-head">
                <h2 id="stage-h"><span className="mono muted">{vi + 1}</span> {t('quality.stages.' + view)}</h2>
                <span className={'tag ' + (vi < current || closed ? 'ok' : vi === current ? 'accent' : '')}>{t(vi < current || closed ? 'quality.detail.stageDone' : vi === current ? 'quality.detail.stageCurrent' : 'quality.detail.stageTodo')}</span>
              </div>
              <div className="card-body stack-sm">
                {vi > current && !closed && view !== 'closed' ? <p className="small muted" style={{ margin: 0 }}>{t('quality.detail.notReached')}</p> : stageBody()}
              </div>
            </section>
            {view !== 'reported' && (
              <section className="card q-o3" aria-labelledby="sum-h">
                <div className="card-head"><h2 id="sum-h">{t('quality.detail.summary')}</h2><Link className="linkbtn small" href={`/quality/${inc.id}?s=reported`}>{t('quality.stages.reported')}</Link></div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('quality.fields.description')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{inc.description}</dd>
                    {inc.immediateActions && <><dt>{t('quality.fields.immediateActions')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{inc.immediateActions}</dd></>}
                    <dt>{t('quality.detail.reportedBy')}</dt><dd>{uname(inc.reportedById)} · <span className="mono small">{rel(inc.createdAt)}</span></dd>
                  </dl>
                </div>
              </section>
            )}
            </div>

            <div className="stack">
              <section className="card q-o2" aria-labelledby="act-h">
                <div className="card-head">
                  <h2 id="act-h">{t('quality.detail.actions')}</h2>
                  <span className={'pill ' + (openActions ? 'warn' : 'ok')}>{actions.length - openActions}/{actions.length}</span>
                </div>
                {actions.length ? (
                  <ul className="list">
                    {actions.map((a) => {
                      const over = !a.done && a.dueAt && a.dueAt < now
                      return (
                        <li key={a.id} className="li" style={{ alignItems: 'center' }}>
                          <ActionCheck id={a.id} done={a.done} disabled={closed || !canReport} label={actionTitle(t, a.title)} />
                          <div className="grow">
                            <div style={a.done ? { color: 'var(--fg-3)', textDecoration: 'line-through', textDecorationColor: 'var(--line-strong)' } : undefined}>{actionTitle(t, a.title)}</div>
                            <div className="small muted">
                              {a.dueAt && <span className={over ? 'crit-text' : ''}>{over ? t('quality.detail.overdue') + ' · ' : ''}{t('quality.detail.due')} <span className="mono">{rel(a.dueAt)}</span></span>}
                              {a.done && a.doneAt && <> · {t('quality.detail.doneBy', { name: uname(a.doneById), at: rel(a.doneAt) })}</>}
                            </div>
                          </div>
                          {a.task && <Link className="tag accent" href="/tasks" title={t('quality.detail.linkedTask')} style={{ textDecoration: 'none' }}>{t('quality.detail.task')}</Link>}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="card-body small muted">{t('quality.detail.noActions')}</div>
                )}
                {!closed && canReport && (
                  <div className="card-foot">
                    <ActionForm action={addActionAction.bind(null, inc.id)} className="form-grid" success="quality.detail.actionAdded">
                      <label className="fld span-all"><span className="lbl">{t('quality.detail.newAction')}</span>
                        <input className="field" name="title" maxLength={300} required placeholder={t('quality.detail.newActionHint')} />
                      </label>
                      <label className="fld"><span className="lbl">{t('quality.detail.dueAt')}</span>
                        <input className="field mono" type="datetime-local" name="dueAt" defaultValue={toLocalInput(new Date(now.getTime() + 3600_000))} />
                      </label>
                      <label className="check" style={{ alignSelf: 'end', minHeight: 34 }}><input type="checkbox" name="asTask" defaultChecked /> {t('quality.detail.asTask')}</label>
                      <div className="form-actions" style={{ alignSelf: 'end' }}><Submit className="btn">{t('common.add')}</Submit></div>
                    </ActionForm>
                  </div>
                )}
              </section>

              <section className="card q-o4" aria-labelledby="aud-h">
                <div className="card-head"><h2 id="aud-h">{t('quality.detail.audit')}</h2><span className="small muted">{t('quality.detail.auditHint')}</span></div>
                {audits.length ? (
                  <ol className="list" style={{ maxHeight: 360, overflow: 'auto' }}>
                    {audits.map((a) => (
                      <li key={String(a.id)} className="li">
                        <time className="mono small muted nowrap" style={{ minWidth: 86 }}>{rel(a.at)}</time>
                        <div className="grow">
                          <div className="small">{t('quality.audit.' + a.action.replace(/\./g, '_'))}{a.action === 'incident.report' || a.action === 'incident.close' ? '' : auditDetail(a.after, t)}</div>
                          <div className="small muted">{uname(a.userId)}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="card-body small muted">{t('quality.detail.auditNone')}</div>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function ReadText({ label, text, empty }: { label: string; text: string | null; empty: string }) {
  return (
    <div className="stack-sm">
      <span className="lbl">{label}</span>
      {text ? <p style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: '72ch' }}>{text}</p> : <p className="small muted" style={{ margin: 0 }}>{empty}</p>}
    </div>
  )
}

function auditDetail(after: unknown, t: (k: string, v?: Record<string, string | number>) => string) {
  if (!after || typeof after !== 'object') return ''
  const o = after as Record<string, unknown>
  if (typeof o.stage === 'string') return ' → ' + t('quality.stages.' + o.stage)
  const fields = Object.keys(o).filter((k) => ['immediateActions', 'assessment', 'analysis', 'conclusion', 'severity'].includes(k))
  if (fields.length) return ': ' + fields.map((k) => t('quality.fields.' + k)).join(', ')
  if (typeof o.title === 'string') return ': ' + o.title
  return ''
}
