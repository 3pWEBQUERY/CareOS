'use client'

import { useOptimistic, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm } from '@/components/ui/ActionForm'
import { Textarea } from '@/components/ui/fields'
import { isKey } from '@/components/meds/shared'
import { reviewVitalAction, undoReviewVitalAction } from './actions'

export type PrioLine = { text: string; vitalId?: string }
export type PrioGroup = { key: string; who?: string; href: string; lines: PrioLine[] }

/**
 * Prioritätenblock (PRD §7.1 Kritisch / Wichtig), pro Person gebündelt.
 * Auffällige Vitalwerte lassen sich direkt als «Gesehen» oder «Massnahme eingeleitet» markieren (PRD §14 ohne Alarmflut):
 * die Zeile verschwindet sofort, «Gesehen» lässt sich im Hinweis rückgängig machen.
 */
export function PriorityBlock({ title, tone, groups, empty, more, canReview }: {
  title: string
  tone: 'crit' | 'warn'
  groups: PrioGroup[]
  empty: string
  /** Hinweis auf weitere Punkte ausserhalb des Filters «Meine» */
  more?: { text: string; href: string } | null
  canReview?: boolean
}) {
  const t = useT()
  const [hidden, hide] = useOptimistic<string[], string>([], (cur, id) => [...cur, id])
  const [done, setDone] = useState<string[]>([])
  const [, start] = useTransition()
  const [dialog, setDialog] = useState<{ vitalId: string; who?: string; text: string } | null>(null)
  const gone = new Set([...hidden, ...done])
  const visible = groups.map((g) => ({ ...g, lines: g.lines.filter((l) => !l.vitalId || !gone.has(l.vitalId)) })).filter((g) => g.lines.length)
  const n = visible.reduce((s, g) => s + g.lines.length, 0)

  const seen = (vitalId: string) => start(async () => {
    hide(vitalId)
    const f = new FormData()
    f.set('vitalId', vitalId)
    f.set('kind', 'seen')
    try {
      const r = await reviewVitalAction(f)
      if (!r.ok) return void toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit', ms: 6000 })
      setDone((d) => [...d, vitalId])
      toast(r.message ? (isKey(r.message) ? t(r.message) : r.message) : t('home.review.toast.seen'), {
        undo: async () => {
          const u = new FormData()
          u.set('vitalId', vitalId)
          const x = await undoReviewVitalAction(u)
          if (x.ok) setDone((d) => d.filter((id) => id !== vitalId))
          else toast(isKey(x.error) ? t(x.error) : x.error, { kind: 'crit', ms: 6000 })
        },
      })
    } catch {
      toast(t('common.genericError'), { kind: 'crit', ms: 6000 })
    }
  })

  return (
    <div className={'card' + (n ? ' ' + tone : '')}>
      <div className="card-head">
        <h3><span className={'tag ' + tone}>{title}</span></h3>
        <span className={'pill ' + (n ? tone : '')}>{n}</span>
      </div>
      {visible.length ? (
        <ul className="list">
          {visible.slice(0, 8).map((g) => (
            <li key={g.key} className="home-prio">
              <Link className="li" href={g.href}>
                <div className="grow">
                  {g.who && <div>{g.who}</div>}
                  {g.lines.map((l, i) => <div key={i} className={'small ' + (tone === 'crit' ? 'crit-text' : 'warn-text')}>{l.text}</div>)}
                </div>
                <span className="muted" aria-hidden="true">→</span>
              </Link>
              {canReview && g.lines.some((l) => l.vitalId) && (
                <div className="home-prio-acts">
                  {g.lines.filter((l) => l.vitalId).map((l) => (
                    <span key={l.vitalId} className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn sm" onClick={() => seen(l.vitalId!)} aria-label={t('home.review.seenFor', { who: g.who ?? '', text: l.text })}>{t('home.review.seen')}</button>
                      <button type="button" className="btn sm" onClick={() => setDialog({ vitalId: l.vitalId!, who: g.who, text: l.text })} aria-label={t('home.review.actionFor', { who: g.who ?? '', text: l.text })}>{t('home.review.action')}</button>
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {visible.length > 8 && <li className="small muted home-prio-more">{t('common.notifications.more', { n: visible.length - 8 })}</li>}
        </ul>
      ) : (
        <div className="card-body small muted">{empty}</div>
      )}
      {more && <Link className="home-prio-out small" href={more.href}>{more.text}</Link>}
      {dialog && (
        <Dialog open onClose={() => setDialog(null)} title={t('home.review.actionTitle')}
          context={<><strong>{dialog.who}</strong><span>{dialog.text}</span></>}>
          <ActionForm action={reviewVitalAction} reset={false} onDone={(r) => { if (r.ok) { setDone((d) => [...d, dialog.vitalId]); setDialog(null) } }}>
            <input type="hidden" name="vitalId" value={dialog.vitalId} />
            <input type="hidden" name="kind" value="action" />
            <Textarea label={t('home.review.note')} name="note" rows={3} required maxLength={500} placeholder={t('home.review.notePh')} />
            <p className="small muted" style={{ margin: 0 }}>{t('home.review.noteHint')}</p>
            <div className="form-actions">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setDialog(null)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary">{t('common.save')}</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </div>
  )
}
