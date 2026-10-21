'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { IconPlus } from '@/components/icons'
import { createConversationAction } from './actions'

type Person = { id: string; name: string; hint: string; clinical: boolean }

export function NewConversation({ people, teams, canClinical }: { people: Person[]; teams: { id: string; name: string }[]; canClinical: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'direct' | 'group' | 'team'>('direct')
  const [clinical, setClinical] = useState(false)
  const [q, setQ] = useState('')
  const list = people.filter((p) => (!clinical || p.clinical) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}><IconPlus size={16} />{t('team.chat.new')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('team.chat.newTitle')}>
        <ActionForm action={createConversationAction} reset={false}>
          <input type="hidden" name="kind" value={kind} />
          <div className="seg" role="group" aria-label={t('team.chat.form.kind')}>
            {(['direct', 'group', ...(teams.length ? ['team'] : [])] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k as typeof kind)}>{t('team.chat.kinds.' + k)}</button>
            ))}
          </div>

          {canClinical && (
            <div className="stack-sm">
              <label className="check"><input type="checkbox" name="clinical" checked={clinical} onChange={(e) => setClinical(e.target.checked)} />{t('team.chat.form.clinical')}</label>
              {clinical && <div className="alert info"><span className="grow">{t('team.chat.form.clinicalHint')}</span></div>}
            </div>
          )}

          {kind === 'direct' && (
            <label className="fld">
              <span className="lbl">{t('team.chat.form.person')}</span>
              <select name="userId" className="field" defaultValue="">
                <option value="" disabled>{t('team.chat.form.pickPerson')}</option>
                {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.hint ? ` · ${p.hint}` : ''}</option>)}
              </select>
            </label>
          )}

          {kind === 'group' && (
            <>
              <label className="fld">
                <span className="lbl">{t('team.chat.form.name')}</span>
                <input name="name" className="field" maxLength={120} autoComplete="off" />
              </label>
              <fieldset>
                <legend className="lbl">{t('team.chat.form.members')}</legend>
                <input type="search" className="field" placeholder={t('team.chat.form.search')} aria-label={t('team.chat.form.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6 }} />
                <div style={{ maxHeight: 240, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                  {people.map((p) => (
                    <label key={p.id} className="check" hidden={!list.includes(p)}>
                      <input type="checkbox" name="members" value={p.id} />
                      <span>{p.name} <span className="small muted">{p.hint}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {kind === 'team' && (
            <label className="fld">
              <span className="lbl">{t('team.chat.form.team')}</span>
              <select name="teamId" className="field" defaultValue={teams[0]?.id}>
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <span className="hint">{t('team.chat.form.teamHint')}</span>
            </label>
          )}

          <div className="form-actions">
            <Submit>{t('team.chat.form.create')}</Submit>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}
