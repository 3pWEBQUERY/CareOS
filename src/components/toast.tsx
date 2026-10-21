'use client'

import { useEffect, useState } from 'react'

export type ToastOpts = { kind?: 'default' | 'crit'; undo?: () => void | Promise<void>; undoLabel?: string; ms?: number }
type Item = ToastOpts & { id: number; msg: string }

let seq = 0
const listeners = new Set<(i: Item) => void>()

/** Kurze Rückmeldung unten rechts. Mit undo nur für ungefährliche Aktionen (PRD §32). */
export function toast(msg: string, opts: ToastOpts = {}) {
  const item = { ...opts, id: ++seq, msg }
  listeners.forEach((l) => l(item))
}

export function Toaster() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const l = (i: Item) => {
      setItems((cur) => [...cur.slice(-2), i])
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== i.id)), i.ms ?? (i.undo ? 6000 : 3200))
    }
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className={'toast' + (i.kind === 'crit' ? ' crit' : '')}>
          <span>{i.msg}</span>
          {i.undo && (
            <button type="button" onClick={async () => { setItems((c) => c.filter((x) => x.id !== i.id)); await i.undo?.() }}>
              {i.undoLabel ?? 'Undo'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
