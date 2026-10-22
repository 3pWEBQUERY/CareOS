'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { useConfirm, splitQuestion } from '@/components/ui/ConfirmDialog'
import { WEEK_ORDER } from '@/lib/care'
import {
  acceptSuggestionAction, aiAreaDraftAction, aiDiscardAction, approveAction, createDraftAction, deactivateInterventionAction,
  discardDraftAction, dismissSuggestionAction, evaluateAction, saveAreaAction, saveInterventionAction, submitAction,
  type AiAreaDraft, type IvInput,
} from './actions'
import { DateField, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'

type Opt = { value: string; label: string }
export type AreaSnapshot = { domain: string; situation: string; resources: string; needs: string; risks: string; goal: string; evaluateBy: string; interventions: { title: string; times: string[] }[] }
type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string }

/** Übersetzt Schlüssel aus Action-Ergebnissen. */
function useTr() {
  const t = useT()
  return (s: string, vars?: Record<string, string | number>) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s, vars) : s)
}

/** Führt eine Action aus, zeigt Fehler/Erfolg und wechselt bei Bedarf in den Entwurf. */
function useRun() {
  const tr = useTr()
  const router = useRouter()
  const path = usePathname()
  const [pending, start] = useTransition()
  const go = (fn: () => Promise<Result>, opts: { success?: string; toDraft?: boolean; onOk?: () => void; onErr?: (e: string) => void } = {}) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) {
        if (opts.onErr) opts.onErr(tr(r.error))
        else toast(tr(r.error), { kind: 'crit' })
        return
      }
      const v = (r.data as { version?: number } | undefined)?.version
      const msg = r.message ?? opts.success
      if (msg) toast(tr(msg, v != null ? { v } : undefined))
      opts.onOk?.()
      if (opts.toDraft) router.push(path + '?v=draft', { scroll: false })
    })
  return { pending, go }
}

// ── Kopfzeile: Version anlegen, einreichen, freigeben ──

export function PlanToolbar({ residentId, view, draft, canEdit, canApprove, hasActive }: {
  residentId: string
  view: 'none' | 'active' | 'draft' | 'archived'
  draft: { id: string; version: number; submitted: boolean } | null
  canEdit: boolean
  canApprove: boolean
  hasActive: boolean
}) {
  const t = useT()
  const { pending, go } = useRun()
  const [confirm, setConfirm] = useState<null | 'approve' | 'discard'>(null)
  return (
    <div className="row">
      {view === 'none' && canEdit && (
        <button type="button" className="btn primary" disabled={pending} data-loading={pending || undefined} onClick={() => go(() => createDraftAction(residentId), { success: 'care.plan.draftCreated', toDraft: true })}>
          {t('care.plan.create')}
        </button>
      )}
      {view === 'active' && canEdit && !draft && (
        <button type="button" className="btn" disabled={pending} onClick={() => go(() => createDraftAction(residentId), { success: 'care.plan.draftCreated', toDraft: true })}>
          {t('care.plan.newVersion')}
        </button>
      )}
      {view === 'draft' && draft && (
        <>
          {canEdit && !draft.submitted && (
            <button type="button" className="btn" disabled={pending} onClick={() => go(() => submitAction(residentId, draft.id))}>{t('care.plan.submit')}</button>
          )}
          {canApprove && (
            <button type="button" className="btn primary" disabled={pending} onClick={() => setConfirm('approve')}>{t('care.plan.approve')}</button>
          )}
          {canEdit && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => setConfirm('discard')}>{t('care.plan.discard')}</button>
          )}
        </>
      )}
      <Dialog
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={confirm === 'approve' ? t('care.plan.approveTitle', { v: draft?.version ?? '' }) : t('care.plan.discard')}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
            <button
              type="button"
              className={confirm === 'approve' ? 'btn primary' : 'btn danger'}
              disabled={pending}
              data-loading={pending || undefined}
              onClick={() => draft && go(() => (confirm === 'approve' ? approveAction(residentId, draft.id) : discardDraftAction(residentId, draft.id)), { onOk: () => setConfirm(null) })}
            >
              {confirm === 'approve' ? t('care.plan.approve') : t('care.plan.discard')}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }}>{confirm === 'approve' ? t(hasActive ? 'care.plan.approveConfirm' : 'care.plan.approveConfirmFirst', { v: draft?.version ?? '' }) : t('care.plan.discardConfirm')}</p>
      </Dialog>
    </div>
  )
}

// ── Massnahme: Felder ──

const emptyIv = (): IvInput => ({ title: '', category: 'Grundpflege', times: '', weekdays: [], durationMin: 10, instructions: '' })

function IvFields({ value, onChange, categories, idp }: { value: IvInput; onChange: (v: IvInput) => void; categories: Opt[]; idp: string }) {
  const t = useT()
  const days = t('common.weekdaysShort').split(',')
  const set = <K extends keyof IvInput>(k: K, v: IvInput[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="form-grid">
      <TextField label={t('care.plan.iv.title')} wrapClassName="span-all" id={idp + 'title'} value={value.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />
      <Select label={t('care.plan.iv.category')} id={idp + 'cat'} value={value.category} onChange={(e) => set('category', e.target.value)}>
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      <TextField label={t('care.plan.iv.times')} hint={t('care.plan.iv.timesHint')} id={idp + 'times'} value={value.times} placeholder="07:30, 14:00" inputMode="numeric" onChange={(e) => set('times', e.target.value)} className="mono" />
      <NumberField label={t('care.plan.iv.duration')} id={idp + 'dur'} min={1} max={480} value={value.durationMin} onChange={(v) => set('durationMin', v === '' ? 0 : v)} step={1} />
      <fieldset className="span-all">
        <legend className="lbl">{t('care.plan.iv.weekdays')}</legend>
        <div className="chips">
          {WEEK_ORDER.map((d) => {
            const on = value.weekdays.includes(d)
            return (
              <button key={d} type="button" className="chip day-chip" aria-pressed={on} onClick={() => set('weekdays', on ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d])}>
                {days[d]}
              </button>
            )
          })}
        </div>
        <span className="small muted">{t('care.plan.iv.weekdaysHint')}</span>
      </fieldset>
      <Textarea label={t('care.plan.iv.instructions')} optional wrapClassName="span-all" id={idp + 'instr'} rows={2} style={{ minHeight: 56 }} value={value.instructions} onChange={(e) => set('instructions', e.target.value)} />
    </div>
  )
}

/** Massnahme hinzufügen oder bearbeiten (immer im Entwurf). */
export function IvButton({ residentId, domain, iv, categories, label, className = 'btn sm', title, context }: {
  residentId: string
  domain: string
  iv?: IvInput
  categories: Opt[]
  label: string
  className?: string
  title: string
  context?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<IvInput>(iv ?? emptyIv())
  const [err, setErr] = useState<string | null>(null)
  const { pending, go } = useRun()
  return (
    <>
      <button type="button" className={className} onClick={() => { setValue(iv ?? emptyIv()); setErr(null); setOpen(true) }}>{label}</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        context={context}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn primary" disabled={pending} data-loading={pending || undefined}
              onClick={() => go(() => saveInterventionAction(residentId, domain, value), { success: 'care.plan.ivSaved', toDraft: true, onOk: () => setOpen(false), onErr: setErr })}>
              {t('common.save')}
            </button>
          </>
        }
      >
        <IvFields value={value} onChange={setValue} categories={categories} idp="iv-" />
        <p className="small muted" style={{ margin: 0 }}>{t('care.plan.draftHint')}</p>
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </Dialog>
    </>
  )
}

export function IvDeactivate({ residentId, ivId, title, context }: { residentId: string; ivId: string; title: string; context?: string }) {
  const t = useT()
  const { pending, go } = useRun()
  const [ask, confirmDialog] = useConfirm()
  return (
    <>
      <button type="button" className="btn sm ghost" disabled={pending} aria-label={t('care.plan.deactivate') + ': ' + title}
        onClick={async () => { if (await ask({ ...splitQuestion(t('care.plan.deactivateConfirm', { title })), context: context ? <span>{context}</span> : undefined, confirmLabel: t('care.plan.deactivate') })) go(() => deactivateInterventionAction(residentId, ivId)) }}>
        {t('care.plan.deactivate')}
      </button>
      {confirmDialog}
    </>
  )
}

// ── Evaluation ──

export function EvaluateButton({ residentId, areaId, defaultNext, domainLabel }: { residentId: string; areaId: string; defaultNext: string; domainLabel: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [next, setNext] = useState(defaultNext)
  const [err, setErr] = useState<string | null>(null)
  const { pending, go } = useRun()
  return (
    <>
      <button type="button" className="btn sm" onClick={() => { setText(''); setNext(defaultNext); setErr(null); setOpen(true) }}>{t('care.plan.evaluate')}</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('care.plan.evaluateTitle', { domain: domainLabel })}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn primary" disabled={pending} data-loading={pending || undefined}
              onClick={() => { const ev = document.querySelector<HTMLInputElement>('#ev-next'); if (ev?.matches(':invalid')) return ev.focus(); go(() => evaluateAction(residentId, areaId, text, next), { onOk: () => setOpen(false), onErr: setErr }) }}>{t('common.save')}</button>
          </>
        }
      >
        <Textarea label={t('care.plan.evalText')} id="ev-text" value={text} placeholder={t('care.plan.prompts.evaluation')} onChange={(e) => setText(e.target.value)} />
        <DateField label={t('care.plan.evalNext')} wrapStyle={{ maxWidth: 220 }} id="ev-next" value={next} onChange={setNext} />
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </Dialog>
    </>
  )
}

// ── Smart Suggestions ──

export function SuggestionActions({ residentId, ruleKey, sourceId, iv, domain, categories, contextLabel }: {
  residentId: string
  ruleKey: string
  sourceId: string
  iv: IvInput
  domain: string
  categories: Opt[]
  contextLabel: string
}) {
  const t = useT()
  const { pending, go } = useRun()
  return (
    <div className="row" style={{ gap: 6 }}>
      <button type="button" className="btn sm primary" disabled={pending} onClick={() => go(() => acceptSuggestionAction(residentId, ruleKey, sourceId), { success: 'care.suggest.accepted', toDraft: true })}>
        {t('care.suggest.accept')}
      </button>
      <IvButton residentId={residentId} domain={domain} iv={iv} categories={categories} label={t('care.suggest.adjust')} title={t('care.suggest.adjustTitle')} context={contextLabel} />
      <button type="button" className="btn sm ghost" disabled={pending} onClick={() => go(() => dismissSuggestionAction(residentId, ruleKey, sourceId))}>
        {t('care.suggest.dismiss')}
      </button>
    </div>
  )
}

// ── Planning Flow (PRD §9.2) ──

const STEPS = ['situation', 'resources', 'needs', 'risks', 'goal', 'interventions', 'evaluation'] as const
type TextKey = 'situation' | 'resources' | 'needs' | 'risks' | 'goal'

export function PlanAreaButton({ residentId, domains, categories, areas, initialDomain, label, className = 'btn primary', aiEnabled, contextLabel, defaultEval }: {
  residentId: string
  domains: Opt[]
  categories: Opt[]
  areas: AreaSnapshot[]
  initialDomain?: string
  label: string
  className?: string
  aiEnabled: boolean
  contextLabel: string
  defaultEval: string
}) {
  const t = useT()
  const tr = useTr()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [domain, setDomain] = useState(initialDomain ?? '')
  const [f, setF] = useState<Record<TextKey, string> & { evaluateBy: string }>({ situation: '', resources: '', needs: '', risks: '', goal: '', evaluateBy: defaultEval })
  const [pendingIvs, setPendingIvs] = useState<IvInput[]>([])
  const [iv, setIv] = useState<IvInput>(emptyIv())
  const [err, setErr] = useState<string | null>(null)
  const [ai, setAi] = useState<AiAreaDraft | null>(null)
  const [aiUsed, setAiUsed] = useState<string | null>(null)
  const [aiPending, startAi] = useTransition()
  const { pending, go } = useRun()

  const existing = areas.find((a) => a.domain === domain)
  const load = (d: string) => {
    const a = areas.find((x) => x.domain === d)
    setF({ situation: a?.situation ?? '', resources: a?.resources ?? '', needs: a?.needs ?? '', risks: a?.risks ?? '', goal: a?.goal ?? '', evaluateBy: a?.evaluateBy || defaultEval })
  }
  const begin = () => {
    const d = initialDomain ?? ''
    setDomain(d)
    load(d)
    setStep(0)
    setPendingIvs([])
    setIv(emptyIv())
    setErr(null)
    setAi(null)
    setAiUsed(null)
    setOpen(true)
  }
  const cur = STEPS[step]
  const last = step === STEPS.length - 1
  const domainName = domains.find((d) => d.value === domain)?.label ?? ''

  const save = () => {
    if (!domain) return setErr(t('care.plan.errors.domainRequired'))
    const ev = document.querySelector<HTMLInputElement>('#pf-eval')
    if (ev?.matches(':invalid')) return ev.focus() // ungültiges Datum: Meldung steht am Feld
    const list = iv.title.trim() ? [...pendingIvs, iv] : pendingIvs
    go(() => saveAreaAction(residentId, { domain, ...f, interventions: list, aiInteractionId: aiUsed }), {
      success: 'care.plan.areaSaved', toDraft: true, onOk: () => setOpen(false), onErr: setErr,
    })
  }
  const askAi = () =>
    startAi(async () => {
      setErr(null)
      const r = await aiAreaDraftAction(residentId, domain, f)
      if (r.ok && r.data) setAi(r.data)
      else if (!r.ok) setErr(tr(r.error))
    })
  const acceptAi = () => {
    if (!ai) return
    setF((x) => ({
      ...x,
      situation: ai.situation || x.situation, resources: ai.resources || x.resources, needs: ai.needs || x.needs, risks: ai.risks || x.risks, goal: ai.goal || x.goal,
    }))
    setPendingIvs((p) => [...p, ...ai.interventions])
    setAiUsed(ai.id)
    setAi(null)
  }
  const discardAi = () => {
    if (ai) void aiDiscardAction(ai.id)
    setAi(null)
  }

  return (
    <>
      <button type="button" className={className} onClick={begin}>{label}</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={t('care.plan.flowTitle')}
        context={contextLabel}
        footer={
          <>
            <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{t('care.plan.stepOf', { n: step + 1, total: STEPS.length })}</span>
            <button type="button" className="btn" onClick={() => (step === 0 ? setOpen(false) : setStep(step - 1))}>{step === 0 ? t('common.cancel') : t('common.back')}</button>
            {last ? (
              <button type="button" className="btn primary" disabled={pending || !domain} data-loading={pending || undefined} onClick={save}>{t('care.plan.saveArea')}</button>
            ) : (
              <button type="button" className="btn primary" disabled={!domain} onClick={() => { setErr(null); setStep(step + 1) }}>{t('care.plan.next')}</button>
            )}
          </>
        }
      >
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <label className="fld" htmlFor="pf-domain" style={{ minWidth: 240, flex: '1 1 240px', maxWidth: 360 }}>
            <span className="lbl">{t('care.plan.domain')}</span>
            {initialDomain ? (
              <strong>{domainName}</strong>
            ) : (
              <Select id="pf-domain" value={domain} onChange={(e) => { setDomain(e.target.value); load(e.target.value) }}>
                <option value="">{t('care.plan.chooseDomain')}</option>
                {domains.map((d) => <option key={d.value} value={d.value}>{d.label}{areas.some((a) => a.domain === d.value) ? ' · ' + t('care.plan.planned') : ''}</option>)}
              </Select>
            )}
          </label>
          {aiEnabled && domain && (
            <button type="button" className="btn sm" disabled={aiPending} data-loading={aiPending || undefined} onClick={askAi}>{aiPending ? t('common.ai.generating') : t('care.plan.aiAssist')}</button>
          )}
        </div>

        <ol className="steps" aria-label={t('care.plan.flowTitle')}>
          {STEPS.map((s, i) => (
            <li key={s} data-state={i === step ? 'current' : i < step ? 'done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <button type="button" className="step-btn" disabled={!domain} onClick={() => setStep(i)}>
                <span className="n">{i < step ? '✓ ' : ''}{i + 1}</span>
                <span>{t('care.plan.fields.' + s)}</span>
              </button>
            </li>
          ))}
        </ol>

        {ai && (
          <div className="ai-box" role="region" aria-label={t('common.ai.badge')}>
            <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
            <div className="ai-text">{ai.raw}</div>
            <div className="row">
              <button type="button" className="btn sm primary" onClick={acceptAi}>{t('common.ai.accept')}</button>
              <button type="button" className="btn sm ghost" onClick={discardAi}>{t('common.ai.discard')}</button>
            </div>
          </div>
        )}
        {aiUsed && <p className="small" style={{ margin: 0 }}><span className="tag violet">{t('care.plan.aiTag')}</span> <span className="muted">{t('care.plan.aiUsedHint')}</span></p>}

        {!domain ? (
          <p className="muted" style={{ margin: 0 }}>{t('care.plan.chooseDomainHint')}</p>
        ) : cur === 'interventions' ? (
          <div className="stack-sm">
            <span className="fg2">{t('care.plan.prompts.interventions')}</span>
            {existing && existing.interventions.length > 0 && (
              <div className="stack-sm">
                <span className="lbl">{t('care.plan.existingIv')}</span>
                <ul className="list card">
                  {existing.interventions.map((x, i) => <li key={i} className="li small"><span className="mono">{x.times.join(', ')}</span><span className="grow">{x.title}</span></li>)}
                </ul>
              </div>
            )}
            {pendingIvs.length > 0 && (
              <div className="stack-sm">
                <span className="lbl">{t('care.plan.pendingIv')}</span>
                <ul className="list card">
                  {pendingIvs.map((x, i) => (
                    <li key={i} className="li small">
                      <span className="mono">{x.times}</span>
                      <span className="grow">{x.title} <span className="muted">· {categories.find((c) => c.value === x.category)?.label}</span></span>
                      <button type="button" className="linkbtn" onClick={() => setPendingIvs(pendingIvs.filter((_, j) => j !== i))}>{t('care.plan.ivRemoveFromList')}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset>
              <legend className="lbl">{t('care.plan.addIntervention')}</legend>
              <IvFields value={iv} onChange={setIv} categories={categories} idp="pf-iv-" />
              <div className="form-actions" style={{ marginTop: 10 }}>
                <button type="button" className="btn sm" disabled={!iv.title.trim()} onClick={() => { setPendingIvs([...pendingIvs, iv]); setIv(emptyIv()) }}>{t('care.plan.ivAddToList')}</button>
              </div>
            </fieldset>
          </div>
        ) : cur === 'evaluation' ? (
          <div className="stack-sm">
            <span className="fg2">{t('care.plan.prompts.evaluation')}</span>
            <DateField label={t('care.plan.evaluateBy')} wrapStyle={{ maxWidth: 220 }} id="pf-eval" value={f.evaluateBy} onChange={(v) => setF({ ...f, evaluateBy: v })} />
            <dl className="kv">
              {(['situation', 'resources', 'needs', 'risks', 'goal'] as const).map((k) => (
                <div key={k} style={{ display: 'contents' }}><dt>{t('care.plan.fields.' + k)}</dt><dd className="ws-pre">{f[k] || <span className="muted">–</span>}</dd></div>
              ))}
              <dt>{t('care.plan.fields.interventions')}</dt>
              <dd>{pendingIvs.length + (iv.title.trim() ? 1 : 0) ? t('care.plan.newIvCount', { n: pendingIvs.length + (iv.title.trim() ? 1 : 0) }) : <span className="muted">–</span>}</dd>
            </dl>
            <p className="small muted" style={{ margin: 0 }}>{t('care.plan.draftHint')}</p>
          </div>
        ) : (
          <label className="fld" htmlFor={'pf-' + cur}>
            <span className="lbl">{t('care.plan.fields.' + cur)}</span>
            <span className="fg2">{t('care.plan.prompts.' + cur)}</span>
            <Textarea id={'pf-' + cur} key={cur} rows={5} autoFocus value={f[cur as TextKey]} onChange={(e) => setF({ ...f, [cur]: e.target.value })} />
          </label>
        )}
        {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </Dialog>
    </>
  )
}
