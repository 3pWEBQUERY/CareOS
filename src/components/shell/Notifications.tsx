'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { IconBell } from '@/components/icons'
import { markNotificationsReadAction } from '@/app/(app)/shell-actions'

type N = { id: string; priority: 'critical' | 'action' | 'info' | 'social'; title: string; body: string | null; href: string | null; at: string; read: boolean }
const ORDER = ['critical', 'action', 'info', 'social'] as const

/** Priorisierte, gebündelte Benachrichtigungen (PRD §25). */
export function Notifications({ unread, critical }: { unread: number; critical: number }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<N[] | null>(null)
  const [, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/notifications').then((r) => r.json()).then((d: { items: N[] }) => setItems(d.items)).catch(() => setItems([]))
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open, unread])

  const groups = ORDER.map((p) => ({ p, list: (items ?? []).filter((n) => n.priority === p) })).filter((g) => g.list.length)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} aria-label={t('common.notifications.title') + (unread ? ` (${unread})` : '')}>
        <IconBell size={18} />
        {unread > 0 && <span className={'count' + (critical ? '' : ' info')}>{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={t('common.notifications.title')}>
          <div className="popover-head">
            <strong>{t('common.notifications.title')}</strong>
            {unread > 0 && (
              <button className="linkbtn small" type="button" onClick={() => start(async () => { await markNotificationsReadAction(); setItems((c) => c?.map((n) => ({ ...n, read: true })) ?? c) })}>
                {t('common.notifications.markAll')}
              </button>
            )}
          </div>
          <div style={{ overflow: 'auto' }}>
            {items === null ? (
              <div className="stack-sm" style={{ padding: 12 }}><div className="skel" /><div className="skel" style={{ width: '70%' }} /></div>
            ) : !groups.length ? (
              <p className="muted" style={{ padding: 12, margin: 0 }}>{t('common.notifications.empty')}</p>
            ) : (
              groups.map((g) => (
                <section key={g.p}>
                  <div className="lbl" style={{ padding: '8px 12px 2px', color: g.p === 'critical' ? 'var(--crit)' : undefined }}>{t('common.notifications.' + g.p)}</div>
                  <ul className="list">
                    {g.list.map((n) => (
                      <li key={n.id}>
                        <Link className={'li' + (n.read ? '' : ' unread')} href={n.href ?? '#'} onClick={() => { setOpen(false); if (!n.read) start(() => markNotificationsReadAction([n.id])) }}>
                          <div className="grow">
                            <div>{n.title}</div>
                            {n.body && <div className="small muted">{n.body}</div>}
                          </div>
                          <time className="small muted mono nowrap">{n.at}</time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
