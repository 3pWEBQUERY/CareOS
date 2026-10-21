'use client'

import { useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import type { ColleagueDto, ResidentCtxDto } from './types'

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

/** Vier-Augen-Kontrolle: zweite Person wählt sich aus und bestätigt mit Passwort. */
export function FourEyes({ colleagues }: { colleagues: ColleagueDto[] }) {
  const t = useT()
  return (
    <fieldset>
      <legend className="lbl">{t('meds.fourEyes.title')}</legend>
      <div className="stack-sm">
        <p className="small fg2" style={{ margin: 0 }}>{t('meds.fourEyes.hint')}</p>
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

export const fmtHm = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
