'use client'

import { useMemo, useState } from 'react'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { permKey } from '@/lib/admin-shared'

type Group = { key: string; perms: string[] }

/** Berechtigungsmatrix einer Rolle: alle Schlüssel gruppiert, mit Gruppen-Schaltern und Änderungszähler. */
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
  const changed = useMemo(() => [...sel].filter((p) => !base.has(p)).length + [...base].filter((p) => !sel.has(p)).length, [sel, base])
  const toggle = (p: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(p); else n.delete(p); return n })
  const setGroup = (g: Group, on: boolean) => setSel((s) => { const n = new Set(s); g.perms.forEach((p) => (on ? n.add(p) : n.delete(p))); return n })
  return (
    <ActionForm action={action} reset={false} success="common.saved" onDone={(r) => r.ok && setBase(new Set(sel))}>
      <input type="hidden" name="id" value={roleId} />
      <div className="form-grid">
        <label className="fld"><span className="lbl">{t('admin.roles.name')}</span><input className="field" name="name" defaultValue={name} required maxLength={80} /></label>
        <label className="fld"><span className="lbl">{t('admin.roles.description')}</span><input className="field" name="description" defaultValue={description} maxLength={300} /></label>
      </div>
      {groups.map((g) => {
        const on = g.perms.filter((p) => sel.has(p)).length
        return (
          <fieldset key={g.key} className="stack-sm">
            <legend className="row" style={{ gap: 8 }}>
              <span className="lbl">{t('admin.permGroups.' + g.key)}</span>
              <span className="pill">{on}/{g.perms.length}</span>
            </legend>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn sm ghost" onClick={() => setGroup(g, true)} disabled={on === g.perms.length}>{t('admin.roles.all')}</button>
              <button type="button" className="btn sm ghost" onClick={() => setGroup(g, false)} disabled={on === 0}>{t('admin.roles.none')}</button>
            </div>
            <div className="tablewrap">
              <table className="stable">
                <tbody>
                  {g.perms.map((p) => (
                    <tr key={p}>
                      <td style={{ width: 36 }}>
                        <input id={'p-' + p} type="checkbox" name="perm" value={p} checked={sel.has(p)} onChange={(e) => toggle(p, e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                      </td>
                      <td><label htmlFor={'p-' + p} style={{ cursor: 'pointer' }}>{t('admin.permissions.' + permKey(p))}</label></td>
                      <td className="right"><code className="mono small muted">{p}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        )
      })}
      <div className="form-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <Submit>{t('common.save')}</Submit>
        <span className="small muted">{changed ? t('admin.roles.changes', { n: changed }) : t('admin.roles.noChanges')}</span>
        <span className="spacer" />
        <span className="small muted mono">{sel.size} / {groups.reduce((s, g) => s + g.perms.length, 0)}</span>
      </div>
    </ActionForm>
  )
}
