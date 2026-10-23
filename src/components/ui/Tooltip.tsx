'use client'

import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { portalTarget } from './field-popover'

/**
 * Tooltip im CareOS-Design statt des Browser-`title`: erscheint bei Zeiger (nach kurzer Verzögerung) und bei
 * Tastaturfokus sofort, schliesst mit Esc, beim Klicken, Scrollen oder Verlassen. Oberhalb des Elements, bei zu
 * wenig Platz darunter; bleibt im Viewport. Auf Touch-Geräten ohne Zeiger erscheint er nicht (das Element braucht
 * deshalb immer einen eigenen zugänglichen Namen, z. B. `aria-label`).
 *
 *   <Tooltip content="Erledigt"><button aria-label="Mit «Erledigt» reagieren">✓</button></Tooltip>
 *
 * `describe`: verbindet den Text zusätzlich per `aria-describedby` (nur, wenn er mehr sagt als der Name).
 */
export function Tooltip({ content, children, placement = 'top', delay = 350, describe = false }: {
  content: ReactNode
  children: ReactElement<Record<string, unknown>>
  placement?: 'top' | 'bottom'
  delay?: number
  describe?: boolean
}) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; side: 'top' | 'bottom' } | null>(null)

  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const show = useCallback((wait: number) => {
    clear()
    if (wait <= 0) setOpen(true)
    else timer.current = setTimeout(() => setOpen(true), wait)
  }, [])
  const hide = useCallback(() => { clear(); setOpen(false); setPos(null) }, [])
  useEffect(() => clear, [])

  // Position nach dem Rendern messen (fixed, damit Scroll-Container nicht abschneiden)
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return
    const el = (anchor.current.firstElementChild as HTMLElement | null) ?? anchor.current
    const r = el.getBoundingClientRect()
    const w = tip.current.offsetWidth
    const h = tip.current.offsetHeight
    const gap = 6
    let side: 'top' | 'bottom' = placement
    if (side === 'top' && r.top - h - gap < 8) side = 'bottom'
    else if (side === 'bottom' && r.bottom + h + gap > window.innerHeight - 8) side = 'top'
    const top = side === 'top' ? r.top - h - gap : r.bottom + gap
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
    setPos({ top, left, side })
  }, [open, placement, content])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  const child = isValidElement(children) && describe
    ? cloneElement(children, { 'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' ') })
    : children
  const target = open ? portalTarget(anchor.current) : null

  return (
    <span
      ref={anchor}
      className="tip-anchor"
      onPointerEnter={(e) => { if (e.pointerType !== 'touch') show(delay) }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => { if ((e.target as HTMLElement).matches(':focus-visible')) show(0) }}
      onBlur={hide}
    >
      {child}
      {target && createPortal(
        <div
          ref={tip}
          id={id}
          role="tooltip"
          className="tip"
          data-side={pos?.side ?? placement}
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          {content}
        </div>,
        target,
      )}
    </span>
  )
}
