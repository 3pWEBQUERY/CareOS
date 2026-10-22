'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/client'

export type ToastOpts = { kind?: 'default' | 'crit'; undo?: () => void | Promise<void>; undoLabel?: string; ms?: number }
type Item = ToastOpts & { id: number; msg: string }

let seq = 0
const listeners = new Set<(i: Item) => void>()

/** Kurze Rückmeldung unten rechts. Mit undo nur für ungefährliche Aktionen (PRD §32). */
export function toast(msg: string, opts: ToastOpts = {}) {
  const item = { ...opts, id: ++seq, msg }
  listeners.forEach((l) => l(item))
}

/**
 * Ausgabe der Toasts. Zwei Live-Regionen: normale Rückmeldungen höflich (status), kritische sofort (alert).
 * Solange die Maus über einem Toast steht oder er den Fokus hat, läuft die Zeit nicht ab (WCAG 2.2.1).
 */
export function Toaster() {
  const t = useT()
  const [items, setItems] = useState<Item[]>([])
  const timers = useRef(new Map<number, { left: number; started: number; h: ReturnType<typeof setTimeout> | null }>())

  const drop = (id: number) => {
    const tm = timers.current.get(id)
    if (tm?.h) clearTimeout(tm.h)
    timers.current.delete(id)
    setItems((cur) => cur.filter((x) => x.id !== id))
  }
  const resume = (id: number) => {
    const tm = timers.current.get(id)
    if (!tm || tm.h) return
    tm.started = Date.now()
    tm.h = setTimeout(() => drop(id), tm.left)
  }
  const pause = (id: number) => {
    const tm = timers.current.get(id)
    if (!tm?.h) return
    clearTimeout(tm.h)
    tm.h = null
    tm.left = Math.max(1500, tm.left - (Date.now() - tm.started))
  }

  useEffect(() => {
    const l = (i: Item) => {
      setItems((cur) => {
        const next = [...cur, i]
        // höchstens drei gleichzeitig; ältere verschwinden
        next.slice(0, -3).forEach((x) => { const tm = timers.current.get(x.id); if (tm?.h) clearTimeout(tm.h); timers.current.delete(x.id) })
        return next.slice(-3)
      })
      timers.current.set(i.id, { left: i.ms ?? (i.undo ? 6000 : 3200), started: Date.now(), h: null })
      resume(i.id)
    }
    listeners.add(l)
    const map = timers.current
    return () => {
      listeners.delete(l)
      map.forEach((tm) => tm.h && clearTimeout(tm.h))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const render = (i: Item) => (
    <div key={i.id} className={'toast' + (i.kind === 'crit' ? ' crit' : '')} onMouseEnter={() => pause(i.id)} onMouseLeave={() => resume(i.id)} onFocus={() => pause(i.id)} onBlur={() => resume(i.id)}>
      <span>{i.msg}</span>
      {i.undo && (
        <button type="button" onClick={async () => { drop(i.id); await i.undo?.() }}>
          {i.undoLabel ?? t('common.undo')}
        </button>
      )}
    </div>
  )
  return (
    <div className="toasts">
      <div role="status" aria-live="polite" className="toasts-region">{items.filter((i) => i.kind !== 'crit').map(render)}</div>
      <div role="alert" aria-live="assertive" className="toasts-region">{items.filter((i) => i.kind === 'crit').map(render)}</div>
    </div>
  )
}
