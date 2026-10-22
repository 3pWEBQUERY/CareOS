'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { useUnsavedGuard } from '@/components/admin/ui'
import { permKey } from '@/lib/admin-shared'

type Group = { key: string; perms: string[] }
type Filter = 'all' | 'on' | 'off' | 'changed'

/**
 * Berechtigungen einer Rolle: Suche, Filter, Gruppen-Schalter (alle/keine, auch teilweise),
 * markierte Änderungen, Verwerfen und Warnung beim Verlassen mit ungespeicherten Änderungen.
 */
export function PermissionMatrix({ roleId, name, description, groups, initial, action }: {
  roleId: string
  name: string
  description: string
  groups: Group[]
  initial: string[]
  action: (f: FormData) => Promise<{ ok: true; message?: string } | { ok: false; error: string; field?: string }>
}) {
  const t = useT()
  const [sel, setSel] = useState(() => new Set(initial))
  const [base, setBase] = useState(() => new Set(initial))
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const added = useMemo(() => [...sel].filter((p) => !base.has(p)), [sel, base])
  const removed = useMemo(() => [...base].filter((p) => !sel.has(p)), [sel, base])
  const changed = added.length + removed.length
  useUnsavedGuard(changed > 0, t('admin.ux.unsaved'))
  const label = (p: string) => t('admin.permissions.' + permKey(p))
  const toggle = (p: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n })
  const setMany = (ps: string[], on: boolean) => setSel((s) => { const n = new Set(s); ps.forEach((p) => (on ? n.add(p) : n.delete(p))); return n })
  const needle = q.trim().toLowerCase()
  const visible = (p: string) => {
    if (needle && !label(p).toLowerCase().includes(needle) && !p.includes(needle)) return false
    if (filter === 'on') return sel.has(p)
    if (filter === 'off') return !sel.has(p)
    if (filter === 'changed') return sel.has(p) !== base.has(p)
    return true
  }
  const shown = groups.map((g) => ({ ...g, list: g.perms.filter(visible) })).filter((g) => g.list.length)
  const total = groups.reduce((s, g) => s + g.perms.length, 0)
  return (
    <ActionForm action={action} reset={false} success="admin.ux.roleSaved" onDone={(r) => r.ok && setBase(new Set(sel))} className="form pm">
      <input type="hidden" name="id" value={roleId} />
      <div className="form-grid">
        <label className="fld"><span className="lbl">{t('admin.roles.name')}</span><input className="field" name="name" defaultValue={name} required maxLength={80} /></label>
        <label className="fld"><span className="lbl">{t('admin.roles.description')}</span><input className="field" name="description" defaultValue={description} maxLength={300} /></label>
      </div>
      {/* Ausgeblendete Berechtigungen werden trotzdem mitgeschickt */}
      {[...sel].filter((p) => !shown.some((g) => g.list.includes(p))).map((p) => <input key={p} type="hidden" name="perm" value={p} />)}
      <div className="pm-tools" role="search">
        <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.ux.permSearch')} aria-label={t('admin.ux.permSearch')} />
        <div className="seg" role="group" aria-label={t('admin.ux.permFilter')}>
          {(['all', 'on', 'off', 'changed'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{t('admin.ux.pf.' + f)}{f === 'changed' && changed ? ` (${changed})` : ''}</button>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('admin.ux.permNone')}</p>}
      {shown.map((g) => {
        const on = g.perms.filter((p) => sel.has(p)).length
        return (
          <fieldset key={g.key} className="pm-group">
            <legend className="sr-only">{t('admin.permGroups.' + g.key)}</legend>
            <div className="pm-ghead">
              <GroupCheck
                label={t('admin.permGroups.' + g.key)}
                state={on === 0 ? 'none' : on === g.perms.length ? 'all' : 'some'}
                onChange={(v) => setMany(g.perms, v)}
              />
              <span className="pill" aria-label={t('admin.ux.ofN', { n: on, total: g.perms.length })}>{on}/{g.perms.length}</span>
            </div>
            <ul className="pm-list">
              {g.list.map((p) => {
                const diff = sel.has(p) !== base.has(p)
                return (
                  <li key={p} data-changed={diff || undefined}>
                    <label className="pm-row">
                      <input type="checkbox" name="perm" value={p} checked={sel.has(p)} onChange={(e) => toggle(p, e.target.checked)} />
                      <span className="grow">
                        <span>{label(p)}</span>
                        {diff && <span className="tag accent pm-diff">{sel.has(p) ? t('admin.ux.added') : t('admin.ux.removed')}</span>}
                      </span>
                      <code className="mono small muted pm-key">{p}</code>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
        )
      })}
      <div className="form-actions pm-bar">
        <span className="small" aria-live="polite">
          {changed ? t('admin.ux.changesDetail', { add: added.length, rem: removed.length }) : <span className="muted">{t('admin.roles.noChanges')}</span>}
        </span>
        <span className="spacer" />
        <span className="small muted mono">{sel.size} / {total}</span>
        {changed > 0 && <button type="button" className="btn ghost" onClick={() => setSel(new Set(base))}>{t('admin.ux.discard')}</button>}
        <Submit className={'btn primary'}>{t('common.save')}</Submit>
      </div>
    </ActionForm>
  )
}

/** Gruppen-Schalter mit Zwischenzustand («teilweise»). */
export function GroupCheck({ label, state, onChange }: { label: string; state: 'all' | 'some' | 'none'; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <label className="check pm-gcheck">
      <input ref={ref} type="checkbox" checked={state === 'all'} aria-checked={state === 'some' ? 'mixed' : state === 'all'} onChange={() => onChange(state !== 'all')} />
      <span className="lbl">{label}</span>
    </label>
  )
}
