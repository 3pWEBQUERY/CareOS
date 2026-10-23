'use client'

/**
 * Gemeinsame Bausteine für DateField, TimeField und DateTimeField: Popover-Position (Desktop unter/über
 * dem Feld, Mobile als Blatt am unteren Rand), Portal-Ziel (im offenen <dialog>, sonst body), Label-
 * Verknüpfung und die Formular-Anbindung (Prüfung beim Absenden, Zurücksetzen).
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

export const SHEET_QUERY = '(max-width: 720px)'

/** Position des Popovers; `sheet` = Blatt am unteren Rand (Mobile). */
export function useAnchoredPopover(open: boolean, anchor: RefObject<HTMLElement | null>, pop: RefObject<HTMLElement | null>, matchWidth = false) {
  const [sheet, setSheet] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' })
      return
    }
    const mq = window.matchMedia(SHEET_QUERY)
    const place = (e?: Event) => {
      if (e && e.type === 'scroll' && pop.current && e.target instanceof Node && pop.current.contains(e.target)) return
      if (mq.matches) {
        setSheet(true)
        setStyle({})
        return
      }
      setSheet(false)
      const a = anchor.current?.getBoundingClientRect()
      const p = pop.current
      if (!a || !p) return
      const m = 8
      const gap = 4
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      const w = Math.max(p.offsetWidth, matchWidth ? a.width : 0)
      const h = p.offsetHeight
      let top = a.bottom + gap
      if (top + h > vh - m && a.top - gap - h >= m) top = a.top - gap - h
      top = Math.max(m, Math.min(top, vh - h - m))
      const left = Math.max(m, Math.min(a.left, vw - w - m))
      setStyle({ top, left, minWidth: matchWidth ? a.width : undefined })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, pop, matchWidth])
  return { sheet, style }
}

/** Popover im offenen modalen Dialog rendern (sonst wäre es inert bzw. abgeschnitten), ausserhalb in body. */
export function portalTarget(el: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return el?.closest('dialog') ?? document.body
}

/** Schliesst bei Zeiger ausserhalb von Feld und Popover. */
export function useOutsideClose(open: boolean, refs: RefObject<HTMLElement | null>[], close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => {
      const tgt = e.target as Node
      if (refs.some((r) => r.current?.contains(tgt))) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', h, true)
    return () => document.removeEventListener('pointerdown', h, true)
  }, [open, refs])
}

let seq = 0
/**
 * Liegt das Feld in einem <label class="fld">, enthält das Label auch den Kalender-Knopf und die
 * Fehlermeldung. Damit der Name des Felds nur die Beschriftung ist, zeigt aria-labelledby auf `.lbl`.
 * Bei <label for=…> ausserhalb des Felds wird das Label selbst verwendet.
 */
export function labelSourceId(input: HTMLInputElement | null): string | null {
  const lab = input?.labels?.[0]
  if (!input || !lab) return null
  const src: HTMLElement | null = lab.contains(input) ? lab.querySelector<HTMLElement>('.lbl') : lab
  if (!src) return null
  if (!src.id) src.id = 'fl-' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6)
  return src.id
}

/**
 * Verknüpft ein eigenes Feld mit seinem Formular: beim Absenden wird der Text übernommen und geprüft;
 * ist er ungültig, bleibt das Formular stehen (auch bei noValidate, z. B. ActionForm), die Meldung
 * erscheint am Feld und das erste ungültige Feld erhält den Fokus. `reset` setzt auf den Startwert zurück.
 */
export function useFormBinding(input: RefObject<HTMLInputElement | HTMLButtonElement | null>, api: RefObject<{ submit: () => string | null; reset: () => void }>) {
  useEffect(() => {
    const form = input.current?.form
    if (!form) return
    const onSubmit = (e: SubmitEvent) => {
      const el = input.current
      if (!el || el.matches(':disabled')) return
      if ((e.submitter as HTMLButtonElement | null)?.formNoValidate) return
      const msg = api.current.submit()
      el.setCustomValidity(msg ?? '')
      if (!msg) return
      e.preventDefault()
      e.stopPropagation() // React-onSubmit (am Dokument) nicht auslösen; andere Felder prüfen trotzdem
      const first = form.querySelector<HTMLElement>('.dtf-in:invalid, .nf-in:invalid, .cb-in:invalid, .sel-btn[aria-invalid="true"]')
      if (!first || first === el) el.focus()
    }
    const onReset = () => setTimeout(() => api.current.reset())
    form.addEventListener('submit', onSubmit)
    form.addEventListener('reset', onReset)
    return () => {
      form.removeEventListener('submit', onSubmit)
      form.removeEventListener('reset', onReset)
    }
  }, [input, api])
}

/** Fokusfalle im Kalender-Dialog (Tab/Umschalt+Tab bleiben im Popover). */
export function trapTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
  if (!items.length) return
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1)
  e.preventDefault()
  items[next].focus()
}

export const IconCal = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2.5v3M13 2.5v3" />
  </svg>
)
export const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" />
  </svg>
)
const CHEVRON = { left: 'M12.5 4.5 7 10l5.5 5.5', right: 'M7.5 4.5 13 10l-5.5 5.5', down: 'M4.5 7.5 10 13l5.5-5.5' }
export const IconChevron = ({ dir }: { dir: 'left' | 'right' | 'down' }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={CHEVRON[dir]} />
  </svg>
)
