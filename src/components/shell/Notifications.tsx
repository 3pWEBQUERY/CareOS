'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { IconBell } from '@/components/icons'
import { markNotificationsReadAction } from '@/app/(app)/shell-actions'

type N = { id: string; priority: 'critical' | 'action' | 'info' | 'social'; title: string; body: string | null; href: string | null; at: string; read: boolean }
const ORDER = ['critical', 'action', 'info', 'social'] as const
const FOCUSABLE = 'a[href], button:not([disabled])'

/**
 * Priorisierte, gebündelte Benachrichtigungen (PRD §25).
 * Tastatur: Öffnen setzt den Fokus in das Popover, Tab bleibt darin, Esc schliesst und gibt den Fokus an die Glocke zurück.
 */
export function Notifications({ unread, critical }: { unread: number; critical: number }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<N[] | null>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/notifications').then((r) => r.json()).then((d: { items: N[] }) => alive && setItems(d.items)).catch(() => alive && setItems([]))
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        btn.current?.focus()
      } else if (e.key === 'Tab' && pop.current) {
        const els = [...pop.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (!els.length) { e.preventDefault(); pop.current.focus(); return }
        const first = els[0]
        const last = els[els.length - 1]
        const inside = pop.current.contains(document.activeElement)
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      alive = false
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, unread])

  // Fokus in das Popover, sobald es sichtbar ist (erst Überschrift, damit Screenreader den Titel ansagen).
  useEffect(() => {
    if (open) pop.current?.focus()
  }, [open])

  const groups = ORDER.map((p) => ({ p, list: (items ?? []).filter((n) => n.priority === p) })).filter((g) => g.list.length)
  const hasUnread = unread > 0 || !!items?.some((n) => !n.read)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'notif-pop' : undefined}
        onClick={() => setOpen(!open)}
        aria-label={t('common.notifications.title') + (unread ? ` (${unread})` : '')}
      >
        <IconBell size={18} />
        {unread > 0 && <span className={'count' + (critical ? '' : ' info')} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div ref={pop} id="notif-pop" className="popover" role="dialog" aria-labelledby="notif-title" tabIndex={-1}>
          <div className="popover-head">
            <h2 id="notif-title" className="sec" style={{ fontSize: '0.875rem' }}>{t('common.notifications.title')}</h2>
            {hasUnread && (
              <button
                className="linkbtn small"
                type="button"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() => start(async () => { await markNotificationsReadAction(); setItems((c) => c?.map((n) => ({ ...n, read: true })) ?? c) })}
              >
                {t('common.notifications.markAll')}
              </button>
            )}
          </div>
          <div style={{ overflow: 'auto' }} aria-busy={items === null || undefined}>
            {items === null ? (
              <div className="stack-sm" style={{ padding: 12 }} aria-hidden="true"><div className="skel" /><div className="skel" style={{ width: '70%' }} /></div>
            ) : !groups.length ? (
              <p className="muted" style={{ padding: 12, margin: 0 }}>{t('common.notifications.empty')}</p>
            ) : (
              groups.map((g) => (
                <section key={g.p} aria-labelledby={'notif-g-' + g.p}>
                  <h3 id={'notif-g-' + g.p} className="lbl" style={{ margin: 0, padding: '8px 12px 2px', color: g.p === 'critical' ? 'var(--crit)' : undefined }}>{t('common.notifications.' + g.p)}</h3>
                  <ul className="list">
                    {g.list.map((n) => (
                      <li key={n.id}>
                        <Link
                          className={'li' + (n.read ? '' : ' unread')}
                          href={n.href ?? '#'}
                          onClick={() => {
                            setOpen(false)
                            if (!n.read) start(() => markNotificationsReadAction([n.id]))
                          }}
                        >
                          <div className="grow">
                            <div>{!n.read && <span className="sr-only">{t('common.notifications.unread')}: </span>}{n.title}</div>
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
