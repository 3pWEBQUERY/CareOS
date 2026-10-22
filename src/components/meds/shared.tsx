'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { setDoseAction } from '@/app/(app)/residents/[id]/meds/actions'
import type { ColleagueDto, DoseStateDto, ResidentCtxDto } from './types'

export type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; field?: string }
export const isKey = (s: string) => /^[a-z]+\.[\w.]+$/.test(s)

/** Server Action mit einfachen Feldern aufrufen; Erfolg als Toast, Fehler als kritischer Toast. */
export function useCall() {
  const t = useT()
  const [pending, start] = useTransition()
  const call = (action: (f: FormData) => Promise<Result>, fields: Record<string, string>, onOk?: (r: Result) => void, silent = false) =>
    start(async () => {
      const f = new FormData()
      for (const [k, v] of Object.entries(fields)) f.set(k, v)
      const r = await action(f)
      if (r.ok) {
        if (r.message && !silent) toast(isKey(r.message) ? t(r.message) : r.message)
        onOk?.(r)
      } else toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit', ms: 6000 })
    })
  return { pending, call }
}

/**
 * Geplante Dosis dokumentieren (Abgabeliste und Medikamentenrunde): sperrt Doppeltipps, solange die Aktion läuft,
 * und bietet für Abgegeben/Verweigert ein Rückgängig im Toast (Storno, bleibt im Verlauf; PRD §32).
 */
export function useDoseCall(day: string) {
  const t = useT()
  const { pending, call } = useCall()
  const [busy, setBusy] = useState<string | null>(null)
  const inflight = useRef(false)
  useEffect(() => { if (!pending) { setBusy(null); inflight.current = false } }, [pending])
  const record = (med: { id: string }, time: string, status: DoseStateDto, expectedId: string) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(med.id + '|' + time)
    call(setDoseAction, { medicationId: med.id, day, time, status, expectedId }, (r) => {
      if (!r.ok) return
      const adminId = (r.data as { adminId?: string } | undefined)?.adminId
      const msg = r.message ? (isKey(r.message) ? t(r.message) : r.message) : ''
      const undoable = !!adminId && (status === 'given' || status === 'refused')
      if (msg) toast(msg, undoable ? { undoLabel: t('common.undo'), undo: () => call(setDoseAction, { medicationId: med.id, day, time, status: 'open', expectedId: adminId! }) } : {})
    }, true)
  }
  return { pending, busy, record, isBusy: (medId: string, time: string) => busy === medId + '|' + time }
}

/** Patientenzuordnung in kritischen Dialogen (PRD §32): Name, Zimmer, Allergien. */
export function ResidentContext({ r }: { r: ResidentCtxDto }) {
  const t = useT()
  return (
    <>
      <strong>{r.name}</strong>
      {r.room && <span className="mono">{t('meds.roomShort', { room: r.room })}</span>}
      {r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>)}
    </>
  )
}

/** Vier-Augen-Kontrolle: zweite Person prüft das Angezeigte, wählt sich aus und bestätigt mit Passwort. */
export function FourEyes({ colleagues, summary }: { colleagues: ColleagueDto[]; summary?: React.ReactNode }) {
  const t = useT()
  return (
    <fieldset className="four-eyes">
      <legend className="lbl">{t('meds.fourEyes.title')}</legend>
      <div className="stack-sm">
        <ol className="four-eyes-steps small">
          <li>{t('meds.fourEyes.step1')}</li>
          <li>{t('meds.fourEyes.step2')}</li>
        </ol>
        {summary && <div className="four-eyes-check">{summary}</div>}
        <div className="form-grid">
          <label className="fld">
            <span className="lbl">{t('meds.fourEyes.colleague')}</span>
            <select className="field" name="checkerId" required defaultValue="">
              <option value="" disabled>{t('meds.fourEyes.choose')}</option>
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="fld">
            <span className="lbl">{t('meds.fourEyes.password')}</span>
            <input className="field" type="password" name="checkerPassword" autoComplete="off" required />
          </label>
        </div>
        {!colleagues.length && <p className="err" style={{ margin: 0 }}>{t('meds.fourEyes.none')}</p>}
      </div>
    </fieldset>
  )
}
