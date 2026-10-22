'use client'

import { createContext, useContext, useOptimistic, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { acknowledgeAction, aiDecisionAction, aiSummaryAction, saveEntryAction, submitHandoverAction } from '@/app/(app)/handover/actions'
import { isKey, useCall } from '@/components/meds/shared'
import { Checkbox, Textarea } from '@/components/ui/fields'

export type HoItem = { text: string; time?: string; tone?: 'c' | 'w' | ''; muted?: boolean; flag?: string }
export type HoBlockDto = {
  resident: { id: string; name: string; room: string | null; meta: string; allergies: string[]; assigned?: { shift: string; list: string[] } }
  cols: { happened: HoItem[]; done: HoItem[]; watch: HoItem[]; open: HoItem[] }
  more: { happened: number; done: number; watch: number; open: number }
  entry: { watch: string | null; open: string | null; important: boolean; author: string | null } | null
  acked: string | null
  others: string[]
}
type Target = { shiftCode: string; date: string }

const COLS = ['happened', 'done', 'watch', 'open'] as const

/**
 * Übernehmen ohne Warten (PRD §31): Übernahmen sind idempotent und ungefährlich – der Status erscheint sofort,
 * der Server bestätigt im Hintergrund; bei Fehler kehrt die Anzeige zurück und ein Hinweis erscheint.
 * «Alle übernehmen» markiert über diesen Bereich alle Karten gleichzeitig.
 */
const AckScope = createContext<{ all: boolean; markAll: () => void; extra: string[]; add: (residentId: string) => void } | null>(null)
export function HandoverAckScope({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useOptimistic(false)
  const [extra, addExtra] = useOptimistic<string[], string>([], (cur, id) => (cur.includes(id) ? cur : [...cur, id]))
  return <AckScope.Provider value={{ all, markAll: () => setAll(true), extra, add: addExtra }}>{children}</AckScope.Provider>
}

/** Kennzahl «Übernommen n/N»: zählt optimistische Übernahmen sofort mit (Einzelkarte und «Alle übernehmen»). */
export function HandoverAckMetric({ ackedIds, total }: { ackedIds: string[]; total: number }) {
  const t = useT()
  const scope = useContext(AckScope)
  const n = scope?.all ? total : new Set([...ackedIds, ...(scope?.extra ?? [])]).size
  return (
    <div className="metric">
      <span className="lbl">{t('tasks.handover.metrics.acked')}</span>
      <span className="val">{n} <small>/ {total}</small></span>
      <div className="bar"><i className={n === total && total ? 'ok' : ''} style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} /></div>
    </div>
  )
}
function useAck() {
  const t = useT()
  const [pending, start] = useTransition()
  const ack = (fields: Record<string, string>, optimistic: () => void) => start(async () => {
    optimistic()
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    try {
      const r = await acknowledgeAction(f)
      if (!r.ok) toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit', ms: 6000 })
      else if (r.message) toast(isKey(r.message) ? t(r.message) : r.message)
    } catch {
      toast(t('common.genericError'), { kind: 'crit', ms: 6000 })
    }
  })
  return { pending, ack }
}
const hmNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

/** Übergabekarte einer Person: vier Fragen (PRD §11.2), Übernehmen, Ergänzen. */
export function HandoverCard({ b, target, canAck, canEdit }: { b: HoBlockDto; target: Target; canAck: boolean; canEdit: boolean }) {
  const t = useT()
  const { pending, ack } = useAck()
  const scope = useContext(AckScope)
  const [mine, setMine] = useOptimistic(false)
  const [edit, setEdit] = useState(false)
  const important = !!b.entry?.important
  const optAcked = !b.acked && (mine || !!scope?.all)
  const acked = !!b.acked || optAcked
  return (
    <section className={'ho' + (acked ? ' acked' : important ? ' important' : '')} aria-labelledby={'ho-' + b.resident.id}>
      <div className="ho-head">
        {b.resident.room && <span className="room">{b.resident.room}</span>}
        <Link className="linkbtn" href={`/residents/${b.resident.id}`} id={'ho-' + b.resident.id}><strong>{b.resident.name}</strong></Link>
        {b.resident.meta && <span className="small muted">{b.resident.meta}</span>}
        {b.resident.assigned && b.resident.assigned.list.length > 0 && <span className="small muted ho-assigned">{t('home.ho.assigned', { shift: b.resident.assigned.shift, list: b.resident.assigned.list.join(', ') })}</span>}
        {b.resident.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>)}
        {important && <span className="tag warn">{t('tasks.handover.important')}</span>}
        <div className="push">
          {canEdit && <button type="button" className="btn ghost" onClick={() => setEdit(true)}>{t(b.entry ? 'tasks.handover.entry.edit' : 'tasks.handover.entry.add')}</button>}
          {canAck && (
            <button type="button" className={'btn' + (important && !acked ? ' primary' : '')} disabled={acked || pending}
              onClick={() => ack({ ...target, residentId: b.resident.id }, () => { setMine(true); scope?.add(b.resident.id) })}>
              {acked ? '✓ ' + t('tasks.handover.acked', { time: b.acked ?? hmNow() }) : t(important ? 'tasks.handover.ackImportant' : 'tasks.handover.ack')}
            </button>
          )}
        </div>
      </div>
      <div className="ho-body">
        {COLS.map((c) => (
          <div className="ho-col" key={c}>
            <span className="lbl">{t('tasks.handover.cols.' + c)}</span>
            {b.cols[c].length ? (
              <ul>
                {b.cols[c].map((i, k) => (
                  <li key={k} className={(i.tone ?? '') + (i.muted ? ' muted' : '')}>
                    {i.time && <span className="mono small">{i.time}</span>} {i.flag && <span className={'tag ' + (i.tone === 'c' ? 'crit' : i.tone === 'w' ? 'warn' : '')}>{i.flag}</span>} {i.text}
                  </li>
                ))}
                {b.more[c] > 0 && <li className="muted small">{t('common.notifications.more', { n: b.more[c] })}</li>}
              </ul>
            ) : (
              <span className="none">{t('tasks.handover.empty.' + c)}</span>
            )}
          </div>
        ))}
      </div>
      {(b.entry?.author || b.others.length > 0) && (
        <div className="ho-foot small muted row" style={{ gap: 16 }}>
          {b.entry?.author && <span>{t('tasks.handover.entry.by', { by: b.entry.author })}</span>}
          {b.others.length > 0 && <span>{t('tasks.handover.ackedBy', { list: b.others.join(', ') })}</span>}
        </div>
      )}
      {edit && (
        <Dialog open onClose={() => setEdit(false)} title={t('tasks.handover.entry.title')} context={<><strong>{b.resident.name}</strong>{b.resident.room && <span className="mono">{t('meds.roomShort', { room: b.resident.room })}</span>}</>}>
          <ActionForm action={saveEntryAction} onDone={(r) => r.ok && setEdit(false)} reset={false}>
            <input type="hidden" name="shiftCode" value={target.shiftCode} />
            <input type="hidden" name="date" value={target.date} />
            <input type="hidden" name="residentId" value={b.resident.id} />
            <Textarea label={t('tasks.handover.cols.watch')} name="watch" rows={3} defaultValue={b.entry?.watch ?? ''} placeholder={t('tasks.handover.entry.watchPh')} />
            <Textarea label={t('tasks.handover.cols.open')} name="open" rows={3} defaultValue={b.entry?.open ?? ''} placeholder={t('tasks.handover.entry.openPh')} />
            <Checkbox name="important" defaultChecked={important} label={t('tasks.handover.entry.important')} />
            <p className="small muted" style={{ margin: 0 }}>{t('tasks.handover.entry.importantHint')}</p>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setEdit(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </section>
  )
}

export type HoImportantDto = { id: string; name: string; room: string | null; watch: string | null; open: string | null }

/** Aktionen der ganzen Übergabe: Alle übernehmen (wichtige Einträge ausdrücklich bestätigen), Abschliessen, KI-Zusammenfassung. */
export function HandoverActions({ target, since, canAck, canAckAll, important, allAcked, canSubmit, submitted, note, aiAvailable, canWrite, scopeIds }: {
  target: Target
  /** «Meine» (PRD §71): nur diese Personen übernehmen, ohne Gesamtbestätigung */
  scopeIds?: string[]
  since: boolean
  canAck: boolean
  canAckAll: boolean
  important: HoImportantDto[]
  allAcked: boolean
  canSubmit: boolean
  submitted: boolean
  note: string | null
  aiAvailable: boolean
  canWrite: boolean
}) {
  const t = useT()
  const { pending, call } = useCall()
  const scope = useContext(AckScope)
  const { pending: allPending, ack } = useAck()
  const allShown = allAcked || !!scope?.all
  const subset: Record<string, string> = scopeIds?.length ? { residentIds: scopeIds.join(',') } : {}
  const [submit, setSubmit] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [ai, setAi] = useState<{ id: string; text: string } | null>(null)
  const [aiPending, startAi] = useTransition()
  const runAi = () => startAi(async () => {
    const f = new FormData()
    f.set('shiftCode', target.shiftCode)
    f.set('date', target.date)
    f.set('since', since ? '1' : '')
    const r = await aiSummaryAction(f)
    if (r.ok && r.data) setAi(r.data)
    else if (!r.ok) toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit' })
  })
  const decide = (accept: boolean) => {
    if (!ai) return
    call(aiDecisionAction, { ...target, aiId: ai.id, accept: accept ? '1' : '', text: ai.text }, () => setAi(null), !accept)
  }
  return (
    <>
      <div className="row">
        {aiAvailable && (
          <button type="button" className="btn" onClick={runAi} disabled={aiPending} data-loading={aiPending || undefined}>
            {aiPending ? t('common.ai.generating') : t('tasks.handover.ai.button')}
          </button>
        )}
        {canSubmit && !submitted && <button type="button" className="btn" onClick={() => setSubmit(true)}>{t('tasks.handover.submit.button')}</button>}
        {canAck && canAckAll && (
          <button type="button" className="btn primary" disabled={pending || allPending || allShown} data-loading={(pending && !confirming) || undefined}
            onClick={() => (important.length ? setConfirming(true) : ack({ ...target, residentId: '', ...subset }, () => scope?.markAll()))}>
            {allShown ? '✓ ' + t(scopeIds?.length ? 'home.ho.allMineAcked' : 'tasks.handover.allAcked') : t(scopeIds?.length ? 'home.ho.ackMine' : 'tasks.handover.ackAll')}
          </button>
        )}
      </div>
      {ai && (
        <div className="ai-box" style={{ flexBasis: '100%' }} role="region" aria-label={t('tasks.handover.ai.button')}>
          <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
          <Textarea rows={Math.min(16, 3 + ai.text.split('\n').length)} value={ai.text} onChange={(e) => setAi({ ...ai, text: e.target.value })} aria-label={t('tasks.handover.ai.button')} className="ai-text" />
          <div className="row">
            {canWrite && !submitted && <button type="button" className="btn sm primary" disabled={pending} onClick={() => decide(true)}>{t('tasks.handover.ai.accept')}</button>}
            <button type="button" className="btn sm" disabled={pending} onClick={() => decide(false)}>{t('common.ai.discard')}</button>
          </div>
        </div>
      )}
      {confirming && <ImportantConfirm items={important} pending={pending} mine={!!scopeIds?.length} onClose={() => setConfirming(false)}
        onConfirm={(ids) => call(acknowledgeAction, { ...target, residentId: '', ...subset, confirmed: ids.join(',') }, () => setConfirming(false))} />}
      {submit && (
        <Dialog open onClose={() => setSubmit(false)} title={t('tasks.handover.submit.title')}>
          <ActionForm action={submitHandoverAction} onDone={(r) => r.ok && setSubmit(false)} confirm="tasks.handover.submit.confirm">
            <input type="hidden" name="shiftCode" value={target.shiftCode} />
            <input type="hidden" name="date" value={target.date} />
            <p className="small fg2" style={{ margin: 0 }}>{t('tasks.handover.submit.hint')}</p>
            <Textarea label={t('tasks.handover.submit.note')} optional name="note" rows={5} defaultValue={note ?? ''} placeholder={t('tasks.handover.submit.notePh')} />
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setSubmit(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('tasks.handover.submit.button')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  )
}

/** Wichtige Einträge vor «Alle übernehmen»: jeder Eintrag wird angezeigt und einzeln bestätigt (PRD §11.4). */
function ImportantConfirm({ items, pending, mine, onClose, onConfirm }: { items: HoImportantDto[]; pending: boolean; mine?: boolean; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const t = useT()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const all = items.every((i) => checked.has(i.id))
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Dialog open onClose={onClose} title={t('tasks.handover.confirm.title', { n: items.length })} wide>
      <p className="small fg2" style={{ margin: 0 }}>{t(mine ? 'home.ho.confirmHintMine' : 'tasks.handover.confirm.hint')}</p>
      <ul className="list card">
        {items.map((i) => (
          <li key={i.id}>
            <div className="li ho-confirm">
              <div className="grow stack-sm" style={{ gap: 4 }}>
                <div className="row" style={{ gap: 8 }}>
                  {i.room && <span className="roomtag">{i.room}</span>}
                  <strong>{i.name}</strong>
                  <span className="tag warn">{t('tasks.handover.important')}</span>
                </div>
                {i.watch && <div className="small"><span className="lbl">{t('tasks.handover.cols.watch')}</span><div className="ws-pre">{i.watch}</div></div>}
                {i.open && <div className="small"><span className="lbl">{t('tasks.handover.cols.open')}</span><div className="ws-pre">{i.open}</div></div>}
                <Checkbox checked={checked.has(i.id)} onChange={() => toggle(i.id)} label={t('tasks.handover.confirm.check')} wrapClassName="ho-check" />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <span className="small muted" aria-live="polite">{t('tasks.handover.confirm.progress', { n: items.filter((i) => checked.has(i.id)).length, total: items.length })}</span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn primary" disabled={!all || pending} data-loading={pending || undefined} onClick={() => onConfirm(items.map((i) => i.id))}>{t(mine ? 'home.ho.confirmButtonMine' : 'tasks.handover.confirm.button')}</button>
      </div>
    </Dialog>
  )
}
