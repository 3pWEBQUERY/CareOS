'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { IconPlus } from '@/components/icons'
import { deleteContact, saveContact } from './actions'

type C = { id: string; name: string; relation: string; phone: string | null; email: string | null; isEmergency: boolean; isLegalRep: boolean; notes: string | null }

export function Contacts({ residentId, who, contacts, canEdit }: { residentId: string; who: string; contacts: C[]; canEdit: boolean }) {
  const t = useT()
  const [edit, setEdit] = useState<C | 'new' | null>(null)
  const [pending, start] = useTransition()
  const cur = edit === 'new' ? null : edit
  const [ask, confirmDialog] = useConfirm()
  const remove = async (c: C) => {
    if (!(await ask({ title: t('residents.contacts.confirmDelete', { name: c.name }), context: <span><strong>{who}</strong> · {c.name} ({c.relation})</span>, confirmLabel: t('common.delete'), danger: true }))) return
    start(async () => {
      const r = await deleteContact(residentId, c.id)
      if (!r.ok) return void toast(t(r.error), { kind: 'crit' })
      toast(t('residents.contacts.deleted'))
      setEdit(null)
    })
  }
  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('residents.contacts.title')}</h2>
        {canEdit && <button type="button" className="btn sm primary" onClick={() => setEdit('new')}><IconPlus size={14} />{t('residents.contacts.add')}</button>}
      </div>
      {contacts.length ? (
        <div className="grid-3">
          {contacts.map((c) => (
            <section key={c.id} className={'card' + (c.isEmergency ? ' warn' : '')}>
              <div className="card-head">
                <h3>{c.name}</h3>
                <span className="muted small">{c.relation}</span>
              </div>
              <div className="card-body stack-sm">
                {(c.isEmergency || c.isLegalRep) && (
                  <div className="row" style={{ gap: 6 }}>
                    {c.isEmergency && <span className="tag warn">{t('residents.contacts.emergency')}</span>}
                    {c.isLegalRep && <span className="tag violet">{t('residents.contacts.legalRep')}</span>}
                  </div>
                )}
                <dl className="kv">
                  <dt>{t('residents.contacts.phone')}</dt><dd className="mono">{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> : '–'}</dd>
                  <dt>{t('residents.contacts.email')}</dt><dd style={{ overflowWrap: 'anywhere' }}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '–'}</dd>
                  {c.notes && <><dt>{t('residents.contacts.notes')}</dt><dd>{c.notes}</dd></>}
                </dl>
              </div>
              {canEdit && <div className="card-foot"><button type="button" className="linkbtn small" onClick={() => setEdit(c)}>{t('common.edit')}</button></div>}
            </section>
          ))}
        </div>
      ) : <p className="empty">{t('residents.contacts.none')}</p>}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title={t(cur ? 'residents.contacts.edit' : 'residents.contacts.add')} context={<span>{who}</span>}>
        {edit && (
          <ActionForm key={cur?.id ?? 'new'} action={saveContact.bind(null, residentId, cur?.id ?? null)} success="common.saved" onDone={(r) => r.ok && setEdit(null)}>
            <div className="form-grid">
              <label className="fld"><span className="lbl">{t('residents.contacts.name')}</span><input className="field" name="name" required maxLength={120} defaultValue={cur?.name} /></label>
              <label className="fld"><span className="lbl">{t('residents.contacts.relation')}</span><input className="field" name="relation" required maxLength={80} defaultValue={cur?.relation} placeholder={t('residents.contacts.relationPh')} /></label>
              <label className="fld"><span className="lbl">{t('residents.contacts.phone')}</span><input className="field mono" name="phone" type="tel" maxLength={40} defaultValue={cur?.phone ?? ''} /></label>
              <label className="fld"><span className="lbl">{t('residents.contacts.email')}</span><input className="field" name="email" type="email" maxLength={120} defaultValue={cur?.email ?? ''} /></label>
              <label className="check span-all"><input type="checkbox" name="isEmergency" defaultChecked={cur?.isEmergency} />{t('residents.contacts.emergency')}</label>
              <label className="check span-all"><input type="checkbox" name="isLegalRep" defaultChecked={cur?.isLegalRep} />{t('residents.contacts.legalRep')}</label>
              <label className="fld span-all"><span className="lbl">{t('residents.contacts.notes')}</span><textarea className="field" name="notes" rows={2} maxLength={1000} defaultValue={cur?.notes ?? ''} /></label>
            </div>
            <div className="form-actions">
              {cur && <button type="button" className="btn danger" onClick={() => remove(cur)} disabled={pending}>{t('common.delete')}</button>}
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </ActionForm>
        )}
      </Dialog>
      {confirmDialog}
    </>
  )
}
