'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useT } from '@/i18n/client'

/**
 * Register der Akte (PRD §8.2). Viele Register: horizontal scrollbar mit sichtbaren Blätter-Knöpfen, das aktive Register
 * wird in den sichtbaren Bereich gerollt. Auf schmalen Bildschirmen bleibt die Leiste beim Scrollen oben stehen und zeigt
 * dann eine kompakte Identitätszeile (Name, Zimmer, REA, Allergien), damit die Patientenzuordnung sichtbar bleibt (§32).
 */
export function ResidentTabs({ base, tabs, label, ident }: { base: string; tabs: { slug: string; label: string; badge?: React.ReactNode }[]; label: string; ident?: React.ReactNode }) {
  const t = useT()
  const path = usePathname()
  const nav = useRef<HTMLElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [stuck, setStuck] = useState(false)

  const measure = useCallback(() => {
    const el = nav.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [])

  useEffect(() => {
    const el = nav.current
    if (!el) return
    const a = el.querySelector<HTMLElement>('[aria-current="page"]')
    if (a) {
      // Aktives Register mittig in den sichtbaren Bereich (ohne die Seite vertikal zu verschieben)
      const d = a.getBoundingClientRect().left - el.getBoundingClientRect().left
      el.scrollLeft += d - (el.clientWidth - a.offsetWidth) / 2
    }
    measure()
  }, [path, measure])

  useEffect(() => {
    const el = nav.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure) }
  }, [measure])

  useEffect(() => {
    const s = sentinel.current
    if (!s || !ident) return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0))
    io.observe(s)
    return () => io.disconnect()
  }, [ident])

  const page = (dir: 1 | -1) => nav.current?.scrollBy({ left: dir * nav.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="rec-sentinel" />
      <div className="rec-tabs" data-stuck={stuck || undefined}>
        {ident && stuck && <div className="rec-ident">{ident}</div>}
        <div className="rec-tabs-row">
          {edges.left && <button type="button" className="rec-tabs-btn left" tabIndex={-1} aria-label={t('residents.rec.tabsBack')} onClick={() => page(-1)}>‹</button>}
          <nav className="tabs" aria-label={label} ref={nav}>
            {tabs.map((tab) => {
              const href = tab.slug ? `${base}/${tab.slug}` : base
              const active = tab.slug ? path.startsWith(href) : path === base
              return (
                <Link key={tab.slug} href={href} aria-current={active ? 'page' : undefined} scroll={false}>
                  {tab.label}
                  {tab.badge}
                </Link>
              )
            })}
          </nav>
          {edges.right && <button type="button" className="rec-tabs-btn right" tabIndex={-1} aria-label={t('residents.rec.tabsMore')} onClick={() => page(1)}>›</button>}
        </div>
      </div>
    </>
  )
}

/** Vorherige/nächste Person, Register bleibt erhalten (für Tablet hoch und Mobile, wo die Liste nicht sichtbar ist). */
export function ResidentPager({ prev, next }: { prev: { id: string; label: string } | null; next: { id: string; label: string } | null }) {
  const t = useT()
  const path = usePathname()
  const seg = path.split('/')
  const tab = seg[3] && seg[3] !== 'export' ? '/' + seg[3] : ''
  return (
    <nav className="rec-pager" aria-label={t('residents.rec.pager')}>
      {prev ? <Link className="btn sm" href={`/residents/${prev.id}${tab}`} aria-label={t('residents.rec.prev', { name: prev.label })} title={prev.label}>‹ <span className="mono">{prev.label.split(' ')[0]}</span></Link> : <span className="btn sm" aria-disabled="true">‹</span>}
      {next ? <Link className="btn sm" href={`/residents/${next.id}${tab}`} aria-label={t('residents.rec.next', { name: next.label })} title={next.label}><span className="mono">{next.label.split(' ')[0]}</span> ›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
    </nav>
  )
}
