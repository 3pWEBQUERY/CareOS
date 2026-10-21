'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Dialog } from '@/components/ui/Dialog'
import { toast } from '@/components/toast'
import { createDocument, updateDocumentMeta, createVersion, updateDraft, askAssistant, type AssistantAnswer } from './actions'

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; field?: string }

export const DOC_CATS = ['guideline', 'instruction', 'emergency', 'hygiene', 'form', 'checklist', 'hr', 'standard'] as const

const tr = (t: (k: string) => string, s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)

/** Knopf für eine gebundene Server Action mit Toast-Rückmeldung. */
export function ActBtn({ action, label, success, confirm, className = 'btn', disabled }: {
  action: () => Promise<Result>
  label: string
  success?: string
  confirm?: string
  className?: string
  disabled?: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || pending}
      data-loading={pending || undefined}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return
        start(async () => {
          const r = await action()
          if (r.ok) { const m = r.message ?? success; if (m) toast(tr(t, m)) }
          else toast(tr(t, r.error), { kind: 'crit' })
        })
      }}
    >
      {label}
    </button>
  )
}

function MetaFields({ d, users }: { d?: Meta; users?: { id: string; name: string }[] }) {
  const t = useT()
  return (
    <div className="form-grid">
      <label className="fld span-all"><span className="lbl">{t('docs.f.title')}</span><input className="field" name="title" defaultValue={d?.title} required maxLength={200} /></label>
      <label className="fld"><span className="lbl">{t('docs.f.category')}</span>
        <select className="field" name="category" defaultValue={d?.category ?? 'guideline'}>
          {DOC_CATS.map((c) => <option key={c} value={c}>{t('docs.cat.' + c)}</option>)}
        </select>
      </label>
      {users && (
        <label className="fld"><span className="lbl">{t('docs.f.owner')}</span>
          <select className="field" name="ownerId" defaultValue={d?.ownerId}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      <label className="fld span-all"><span className="lbl">{t('docs.f.tags')}</span><input className="field" name="tags" defaultValue={d?.tags.join(', ')} placeholder={t('docs.f.tagsHint')} /></label>
      <label className="fld"><span className="lbl">{t('docs.f.validFrom')}</span><input className="field" type="date" name="validFrom" defaultValue={d?.validFrom ?? ''} /></label>
      <label className="fld"><span className="lbl">{t('docs.f.validUntil')}</span><input className="field" type="date" name="validUntil" defaultValue={d?.validUntil ?? ''} /></label>
      <label className="check span-all"><input type="checkbox" name="requireAck" defaultChecked={d?.requireAck} /> {t('docs.f.requireAck')}</label>
    </div>
  )
}

export type Meta = { id: string; title: string; category: string; tags: string[]; requireAck: boolean; validFrom: string | null; validUntil: string | null; ownerId: string }

export function NewDocButton() {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('docs.new')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('docs.new')} wide>
        <ActionForm action={createDocument} success="docs.created" onDone={(r) => { if (r.ok) { setOpen(false); router.push(`/docs/${(r.data as { id: string }).id}`) } }}>
          <MetaFields />
          <div className="form-grid">
            <label className="fld"><span className="lbl">{t('docs.f.version')}</span><input className="field mono" name="version" defaultValue="1.0" /></label>
            <label className="fld"><span className="lbl">{t('docs.f.file')} <span className="muted">({t('common.optional')})</span></span><input className="field" type="file" name="file" /></label>
          </div>
          <label className="fld"><span className="lbl">{t('docs.f.body')}</span><textarea className="field mono" name="body" rows={12} placeholder={t('docs.f.bodyHint')} /></label>
          <div className="form-actions"><span className="small muted">{t('docs.f.draftHint')}</span><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.create')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

export function MetaButton({ d, users }: { d: Meta; users: { id: string; name: string }[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{t('docs.editMeta')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('docs.editMeta')} wide>
        <ActionForm action={updateDocumentMeta} success="common.saved" reset={false} onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name="id" value={d.id} />
          <MetaFields d={d} users={users} />
          <div className="form-actions"><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.save')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

/** Neue Version (Entwurf) anlegen oder Entwurf bearbeiten. */
export function VersionButton({ documentId, draft, suggest, suggestCritical, baseBody, hasFile, label, className = 'btn' }: {
  documentId: string
  draft?: { id: string; version: string; body: string; changeNote: string | null; critical: boolean; fileName: string | null }
  suggest?: string
  suggestCritical?: string
  baseBody?: string
  hasFile?: boolean
  label: string
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const verRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={draft ? t('docs.version.editDraft', { v: draft.version }) : t('docs.version.new')} wide>
        <ActionForm action={draft ? updateDraft : createVersion} success={draft ? 'common.saved' : 'docs.version.created'} reset={false} onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name={draft ? 'versionId' : 'documentId'} value={draft ? draft.id : documentId} />
          <div className="form-grid">
            <label className="fld"><span className="lbl">{t('docs.f.version')}</span><input ref={verRef} className="field mono" name="version" defaultValue={draft?.version ?? suggest} required /></label>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" name="critical" defaultChecked={draft?.critical} onChange={(e) => { if (!draft && verRef.current && suggest && suggestCritical) verRef.current.value = e.target.checked ? suggestCritical : suggest }} />
              {t('docs.f.critical')}
            </label>
            <label className="fld span-all"><span className="lbl">{t('docs.f.changeNote')}</span><input className="field" name="changeNote" defaultValue={draft?.changeNote ?? ''} maxLength={300} placeholder={t('docs.f.changeNoteHint')} /></label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('docs.f.criticalHint')}</p>
          <label className="fld"><span className="lbl">{t('docs.f.body')}</span><textarea className="field mono" name="body" rows={16} defaultValue={draft?.body ?? baseBody} /><span className="hint">{t('docs.f.bodyHint')}</span></label>
          <div className="form-grid">
            <label className="fld"><span className="lbl">{t('docs.f.file')} <span className="muted">({t('common.optional')})</span></span><input className="field" type="file" name="file" /></label>
            {draft?.fileName ? (
              <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="removeFile" /> {t('docs.f.removeFile', { name: draft.fileName })}</label>
            ) : !draft && hasFile ? (
              <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="keepFile" defaultChecked /> {t('docs.f.keepFile')}</label>
            ) : null}
          </div>
          <div className="form-actions"><span className="small muted">{t('docs.f.draftHint')}</span><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.save')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

/** KI-Antwort des Search Assistant – nur Entwurf, mit Quellen, nichts wird gespeichert. */
export function AssistantAi({ q, auto }: { q: string; auto: boolean }) {
  const t = useT()
  const [state, setState] = useState<{ k: 'idle' } | { k: 'busy' } | { k: 'ok'; a: AssistantAnswer } | { k: 'err'; msg: string }>({ k: 'idle' })
  const ask = () => {
    setState({ k: 'busy' })
    askAssistant(q).then((r) => setState(r.ok && r.data ? { k: 'ok', a: r.data } : { k: 'err', msg: r.ok ? t('common.genericError') : tr(t, r.error) }))
  }
  useEffect(() => {
    if (auto) ask()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, auto])
  return (
    <div className="ai-box" aria-live="polite">
      <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('docs.assistant.aiHint')}</span></div>
      {state.k === 'idle' && <div><button type="button" className="btn sm" onClick={ask}>{t('docs.assistant.ask')}</button></div>}
      {state.k === 'busy' && <div className="ai-text muted">{t('common.ai.generating')}</div>}
      {state.k === 'err' && <div className="small">{state.msg}</div>}
      {state.k === 'ok' && (
        <>
          <div className="ai-text">{state.a.text}</div>
          <div className="row small">
            <span className="lbl">{t('docs.assistant.sources')}</span>
            {state.a.sources.map((s) => <Link key={s.id} href={`/docs/${s.id}`}>[{s.n}] {s.title} <span className="mono">v{s.version}</span></Link>)}
          </div>
          <span className="small fg2">{t('common.ai.disclaimer')}</span>
        </>
      )}
    </div>
  )
}
