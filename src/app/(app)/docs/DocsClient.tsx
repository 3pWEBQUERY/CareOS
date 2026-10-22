'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Dialog } from '@/components/ui/Dialog'
import { useConfirm, splitQuestion } from '@/components/ui/ConfirmDialog'
import { toast } from '@/components/toast'
import { createDocument, updateDocumentMeta, createVersion, updateDraft, askAssistant, type AssistantAnswer } from './actions'
import { Checkbox, CheckboxGroup, Combobox, DateField, FileField, Select, TextField, Textarea } from '@/components/ui/fields'
import { ACCEPT_UPLOADS, MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; field?: string }

export const DOC_CATS = ['guideline', 'instruction', 'emergency', 'hygiene', 'form', 'checklist', 'hr', 'standard'] as const

const tr = (t: (k: string) => string, s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)

/** Knopf für eine gebundene Server Action mit Toast-Rückmeldung. */
export function ActBtn({ action, label, success, confirm, className = 'btn', disabled, context, danger }: {
  action: () => Promise<Result>
  label: string
  success?: string
  confirm?: string
  className?: string
  disabled?: boolean
  /** Betroffener Datensatz im Bestätigungsdialog (PRD §32). */
  context?: React.ReactNode
  danger?: boolean
}) {
  const t = useT()
  const [pending, start] = useTransition()
  const [ask, confirmDialog] = useConfirm()
  return (
    <>
    <button
      type="button"
      className={className}
      disabled={disabled || pending}
      data-loading={pending || undefined}
      onClick={async () => {
        if (confirm && !(await ask({ ...splitQuestion(tr(t, confirm)), context, confirmLabel: label, danger: danger ?? /\bdanger\b/.test(className) }))) return
        start(async () => {
          const r = await action()
          if (r.ok) { const m = r.message ?? success; if (m) toast(tr(t, m)) }
          else toast(tr(t, r.error), { kind: 'crit' })
        })
      }}
    >
      {label}
    </button>
    {confirmDialog}
    </>
  )
}

/** Druckansicht des Dokuments (Lesefassung ohne Navigation, Verlauf und Aktionen). */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn ghost doc-print" onClick={() => window.print()}>{label}</button>
}

export type RoleOption = { key: string; name: string }

function MetaFields({ d, users, roles }: { d?: Meta; users?: { id: string; name: string }[]; roles: RoleOption[] }) {
  const t = useT()
  return (
    <div className="form-grid">
      <TextField label={t('docs.f.title')} wrapClassName="span-all" name="title" defaultValue={d?.title} required maxLength={200} />
      <Select label={t('docs.f.category')} name="category" defaultValue={d?.category ?? 'guideline'}>
          {DOC_CATS.map((c) => <option key={c} value={c}>{t('docs.cat.' + c)}</option>)}
        </Select>
      {users && (
        <Combobox label={t('docs.f.owner')} name="ownerId" defaultValue={d?.ownerId ?? users[0]?.id} required options={users.map((u) => ({ value: u.id, label: u.name }))} />
      )}
      <TextField label={t('docs.f.tags')} wrapClassName="span-all" name="tags" defaultValue={d?.tags.join(', ')} placeholder={t('docs.f.tagsHint')} />
      <DateField label={t('docs.f.validFrom')} name="validFrom" defaultValue={d?.validFrom ?? ''} />
      <DateField label={t('docs.f.validUntil')} name="validUntil" defaultValue={d?.validUntil ?? ''} />
      <Checkbox name="requireAck" defaultChecked={d?.requireAck} label={t('docs.f.requireAck')} wrapClassName="span-all" />
      <CheckboxGroup label={t('docs.audience.label')} hint={t('docs.audience.hint')} name="audienceRoles" inline small optional wrapClassName="span-all" defaultValue={d?.audienceRoles} options={roles.map((r) => ({ value: r.key, label: r.name }))} />
    </div>
  )
}

export type Meta = { id: string; title: string; category: string; tags: string[]; requireAck: boolean; validFrom: string | null; validUntil: string | null; ownerId: string; audienceRoles: string[] }

export function NewDocButton({ roles }: { roles: RoleOption[] }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('docs.new')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('docs.new')} wide>
        <ActionForm action={createDocument} success="docs.created" onDone={(r) => { if (r.ok) { setOpen(false); router.push(`/docs/${(r.data as { id: string }).id}`) } }}>
          <MetaFields roles={roles} />
          <div className="form-grid">
            <TextField label={t('docs.f.version')} name="version" defaultValue="1.0" className="mono" />
            <FileField label={t('docs.f.file')} optional name="file" accept={ACCEPT_UPLOADS} maxSize={MAX_UPLOAD_BYTES} typesLabel="PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT, CSV, MP4" />
          </div>
          <Textarea label={t('docs.f.body')} name="body" rows={12} placeholder={t('docs.f.bodyHint')} className="mono" />
          <div className="form-actions"><span className="small muted">{t('docs.f.draftHint')}</span><span className="spacer" /><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><Submit>{t('common.create')}</Submit></div>
        </ActionForm>
      </Dialog>
    </>
  )
}

export function MetaButton({ d, users, roles }: { d: Meta; users: { id: string; name: string }[]; roles: RoleOption[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{t('docs.editMeta')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('docs.editMeta')} wide>
        <ActionForm action={updateDocumentMeta} success="common.saved" reset={false} onDone={(r) => r.ok && setOpen(false)}>
          <input type="hidden" name="id" value={d.id} />
          <MetaFields d={d} users={users} roles={roles} />
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
            <TextField label={t('docs.f.version')} ref={verRef} name="version" defaultValue={draft?.version ?? suggest} required className="mono" />
            <Checkbox name="critical" defaultChecked={draft?.critical} onChange={(e) => { if (!draft && verRef.current && suggest && suggestCritical) verRef.current.value = e.target.checked ? suggestCritical : suggest }} label={t('docs.f.critical')} wrapStyle={{ alignSelf: 'end' }} />
            <TextField label={t('docs.f.changeNote')} wrapClassName="span-all" name="changeNote" defaultValue={draft?.changeNote ?? ''} maxLength={300} placeholder={t('docs.f.changeNoteHint')} />
          </div>
          <p className="small muted" style={{ margin: 0 }}>{t('docs.f.criticalHint')}</p>
          <Textarea label={t('docs.f.body')} hint={t('docs.f.bodyHint')} name="body" rows={16} defaultValue={draft?.body ?? baseBody} className="mono" />
          <div className="form-grid">
            <FileField label={t('docs.f.file')} optional name="file" accept={ACCEPT_UPLOADS} maxSize={MAX_UPLOAD_BYTES} typesLabel="PDF, DOCX, XLSX, PPTX, JPG, PNG, TXT, CSV, MP4" />
            {draft?.fileName ? (
              <Checkbox name="removeFile" label={t('docs.f.removeFile', { name: draft.fileName })} wrapStyle={{ alignSelf: 'end' }} />
            ) : !draft && hasFile ? (
              <Checkbox name="keepFile" defaultChecked label={t('docs.f.keepFile')} wrapStyle={{ alignSelf: 'end' }} />
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
