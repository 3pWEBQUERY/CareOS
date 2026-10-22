'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useUnsavedGuard } from '@/components/admin/ui'
import { permKey } from '@/lib/admin-shared'
import { GroupCheck } from './Matrix'
import { saveRoleMatrixAction } from './actions'

type Role = { id: string; name: string; system: boolean; permissions: string[] }
type Group = { key: string; perms: string[] }

/**
 * Berechtigungsmatrix über alle Rollen (PRD §34): Zeilen = Berechtigungen (gruppiert), Spalten = Rollen.
 * Kopfzeile und erste Spalte bleiben beim Scrollen stehen, Gruppen-Schalter je Rolle, Suche,
 * markierte Änderungen, gemeinsames Speichern und Warnung beim Verlassen.
 */
export function RoleMatrix({ roles, groups }: { roles: Role[]; groups: Group[] }) {
  const t = useT()
  const initial = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)])), [roles])
  const [base, setBase] = useState<Record<string, Set<string>>>(initial)
  const [sel, setSel] = useState<Record<string, Set<string>>>(() => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)])))
  const [q, setQ] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const label = (p: string) => t('admin.permissions.' + permKey(p))

  const changedRoles = roles.filter((r) => {
    const a = sel[r.id], b = base[r.id]
    return a.size !== b.size || [...a].some((p) => !b.has(p))
  })
  const changes = roles.reduce((n, r) => n + [...sel[r.id]].filter((p) => !base[r.id].has(p)).length + [...base[r.id]].filter((p) => !sel[r.id].has(p)).length, 0)
  const leaveDialog = useUnsavedGuard(changes > 0, t('admin.ux.unsaved'))

  const set = (roleId: string, ps: string[], on: boolean) =>
    setSel((cur) => {
      const n = new Set(cur[roleId])
      ps.forEach((p) => (on ? n.add(p) : n.delete(p)))
      return { ...cur, [roleId]: n }
    })
  const needle = q.trim().toLowerCase()
  const differs = (p: string) => roles.some((r) => sel[r.id].has(p) !== base[r.id].has(p))
  const shown = groups
    .map((g) => ({ ...g, list: g.perms.filter((p) => (!needle || label(p).toLowerCase().includes(needle) || p.includes(needle)) && (!onlyDiff || differs(p))) }))
    .filter((g) => g.list.length)

  const save = () =>
    start(async () => {
      setError(null)
      const r = await saveRoleMatrixAction(changedRoles.map((x) => ({ id: x.id, permissions: [...sel[x.id]] })))
      if (r.ok) {
        setBase(Object.fromEntries(roles.map((x) => [x.id, new Set(sel[x.id])])))
        toast(t('admin.ux.matrixSaved', { n: changedRoles.length }))
      } else setError(/^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error)
    })

  return (
    <div className="stack-sm rm">
      <div className="pm-tools" role="search">
        <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.ux.permSearch')} aria-label={t('admin.ux.permSearch')} />
        <label className="check"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /><span>{t('admin.ux.onlyChanged')}</span></label>
      </div>
      <div className="rm-wrap" tabIndex={0} role="region" aria-label={t('admin.ux.matrixTitle')}>
        <table className="rm-table">
          <caption className="sr-only">{t('admin.ux.matrixCaption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="rm-corner">{t('admin.ux.permission')}</th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="rm-role">
                  <Link href={`/admin/roles/${r.id}`}>{r.name}</Link>
                  <span className="mono small muted">{sel[r.id].size}</span>
                </th>
              ))}
            </tr>
          </thead>
          {shown.map((g) => (
            <tbody key={g.key}>
              <tr className="rm-group">
                <th scope="rowgroup" className="rm-first"><span className="lbl">{t('admin.permGroups.' + g.key)}</span></th>
                {roles.map((r) => {
                  const on = g.perms.filter((p) => sel[r.id].has(p)).length
                  return (
                    <td key={r.id}>
                      <GroupCheck hideLabel label={`${t('admin.permGroups.' + g.key)} · ${r.name}`} state={on === 0 ? 'none' : on === g.perms.length ? 'all' : 'some'} onChange={(v) => set(r.id, g.perms, v)} />
                    </td>
                  )
                })}
              </tr>
              {g.list.map((p) => (
                <tr key={p}>
                  <th scope="row" className="rm-first">
                    <span className="rm-pl">{label(p)}</span>
                    <code className="mono muted rm-pk">{p}</code>
                  </th>
                  {roles.map((r) => {
                    const on = sel[r.id].has(p)
                    const diff = on !== base[r.id].has(p)
                    return (
                      <td key={r.id} data-changed={diff || undefined}>
                        <label className="rm-cell">
                          <input type="checkbox" checked={on} onChange={(e) => set(r.id, [p], e.target.checked)} aria-label={`${label(p)} · ${r.name}${diff ? ' · ' + t('admin.ux.changed') : ''}`} />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {shown.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('admin.ux.permNone')}</p>}
      <div className="form-actions pm-bar">
        <span className="small" aria-live="polite">
          {changes ? t('admin.ux.matrixChanges', { n: changes, roles: changedRoles.length }) : <span className="muted">{t('admin.roles.noChanges')}</span>}
        </span>
        <span className="spacer" />
        {changes > 0 && <button type="button" className="btn ghost" disabled={pending} onClick={() => setSel(Object.fromEntries(roles.map((x) => [x.id, new Set(base[x.id])])))}>{t('admin.ux.discard')}</button>}
        <button type="button" className="btn primary" disabled={!changes || pending} data-loading={pending || undefined} onClick={save}>{t('common.save')}</button>
      </div>
      {error && <p className="err" role="alert" style={{ margin: 0 }}>{error}</p>}
      {leaveDialog}
    </div>
  )
}
