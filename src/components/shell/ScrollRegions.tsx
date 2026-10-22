'use client'

import { useEffect } from 'react'
import { useT } from '@/i18n/client'

const SEL = '.tablewrap, [data-scroll]'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Tastaturbedienung für scrollende Tabellen und Listen (WCAG 2.1.1): Ein Scrollbereich ohne eigenes
 * fokussierbares Element bekommt tabindex="0" (Pfeiltasten scrollen), role="group" und als Namen die
 * Tabellenüberschrift bzw. die nächste Überschrift. Gilt für `.tablewrap` und Elemente mit `data-scroll`.
 * Läuft bei jeder DOM-Änderung und Grössenänderung neu; passt der Inhalt wieder, wird es zurückgenommen.
 */
export function ScrollRegions() {
  const t = useT()
  const fallback = t('common.scrollTable')
  useEffect(() => {
    let raf = 0
    const name = (el: HTMLElement) => {
      const cap = el.querySelector('caption')?.textContent?.trim() || el.querySelector('table')?.getAttribute('aria-label')
      if (cap) return cap
      // nächste Überschrift davor (Karte oder Abschnitt)
      for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) {
        for (let s = p.previousElementSibling; s; s = s.previousElementSibling) {
          const h = s.matches('h1,h2,h3,h4,.lbl') ? s : s.querySelector('h2,h3,h4')
          if (h?.textContent?.trim()) return h.textContent.trim()
        }
      }
      return fallback
    }
    const apply = () => {
      raf = 0
      for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
        const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
        // Merker, welche Attribute von hier stammen (t = tabindex, r = role, l = aria-label) – nur diese werden zurückgenommen
        const managed = el.dataset.scrollFocus
        if (scrolls && !el.querySelector(FOCUSABLE)) {
          if (!managed && !el.hasAttribute('tabindex')) {
            let m = 't'
            el.tabIndex = 0
            // Listen behalten ihre Rolle; nur neutrale Container werden zur benannten Gruppe
            if (el.tagName === 'DIV' && !el.hasAttribute('role')) { el.setAttribute('role', 'group'); m += 'r' }
            if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) { el.setAttribute('aria-label', name(el)); m += 'l' }
            el.dataset.scrollFocus = m
          }
        } else if (managed) {
          el.removeAttribute('tabindex')
          if (managed.includes('r')) el.removeAttribute('role')
          if (managed.includes('l')) el.removeAttribute('aria-label')
          delete el.dataset.scrollFocus
        }
      }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }
    schedule()
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => { mo.disconnect(); window.removeEventListener('resize', schedule); if (raf) cancelAnimationFrame(raf) }
  }, [fallback])
  return null
}
