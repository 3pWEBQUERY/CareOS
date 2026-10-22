'use client'

import { createContext, useContext, useOptimistic } from 'react'
import { useT } from '@/i18n/client'
import { ackPostAction } from '../actions'
import { ActButton } from './ActButton'

/**
 * «Zu bestätigen» zählt sofort mit (PRD §31): Kenntnisnahmen aus der Warteschlange verringern Zähler im
 * Kartenkopf und in den Kennzahlen optimistisch; bei Fehler kehren sie zurück, nach dem Neuladen gilt der Server.
 */
const Ctx = createContext<{ done: string[]; add: (id: string) => void } | null>(null)

export function AckCountScope({ children }: { children: React.ReactNode }) {
  const [done, add] = useOptimistic<string[], string>([], (cur, id) => (cur.includes(id) ? cur : [...cur, id]))
  return <Ctx.Provider value={{ done, add }}>{children}</Ctx.Provider>
}

/** Anzahl offener Kenntnisnahmen abzüglich der eben bestätigten. */
export function AckPending({ total, className, warnClass }: { total: number; className: string; warnClass: string }) {
  const n = Math.max(0, total - (useContext(Ctx)?.done.length ?? 0))
  return <span className={className + (n ? ' ' + warnClass : '')}>{n}</span>
}

/** «Zur Kenntnis genommen» in der Warteschlange. */
export function AckQueueButton({ postId }: { postId: string }) {
  const t = useT()
  const scope = useContext(Ctx)
  return (
    <ActButton action={() => ackPostAction(postId)} className="btn primary" optimistic={<>✓ {t('team.ack.confirmed')}</>} optimisticClassName="btn" onOptimistic={() => scope?.add(postId)}>
      ✓ {t('team.ack.button')}
    </ActButton>
  )
}
