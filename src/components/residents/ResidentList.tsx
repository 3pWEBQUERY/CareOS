'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@/i18n/client'
import { ResidentWorkspace } from '@/components/shell/ListDrawer'
import { TextField } from '@/components/ui/fields'

export type ResRow = { id: string; room: string; name: string; meta: string; over: number; open: number; changed: boolean; search: string }

/** Register der Akte, das beim Personenwechsel erhalten bleibt (PRD §31 «schnelle Bewohnerwechsel»). */
export function residentHref(id: string, path: string, pick?: string | null) {
  if (pick) return `/residents/${id}/${pick}`
  const seg = path.split('/')
  const tab = seg[1] === 'residents' && seg[2] && seg[3] && seg[3] !== 'export' ? seg[3] : ''
  return `/residents/${id}${tab ? '/' + tab : ''}`
}

/**
 * Bewohnerliste (linke Spalte). "/" fokussiert den Filter, ↓ springt vom Filter in die Liste, Enter öffnet den ersten Treffer,
 * ↑/↓ bewegen den Fokus in der Liste, Alt+↑/↓ wechselt aus der Akte zur vorherigen/nächsten Person (Register bleibt).
 * Im Auswahlmodus (?pick=notes) springt der Klick direkt in den Bereich.
 */
export function ResidentList({ rows }: { rows: ResRow[] }) {
  const t = useT()
  const path = usePathname()
  const sp = useSearchParams()
  const pick = sp.get('pick')
  const router = useRouter()
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const needle = q.trim().toLowerCase()
  const list = rows.filter((r) => !needle || r.search.includes(needle))
  const currentId = path.split('/')[2]
  const href = (id: string) => residentHref(id, path, pick)
  const idx = rows.findIndex((r) => r.id === currentId)
  const prev = idx > 0 ? rows[idx - 1] : null
  const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null
  const prevHref = prev ? href(prev.id) : null
  const nextHref = next ? href(next.id) : null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? '') || (document.activeElement as HTMLElement)?.isContentEditable
      if (e.key === '/' && !typing) {
        e.preventDefault()
        ref.current?.focus()
      } else if (e.altKey && !typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const to = e.key === 'ArrowDown' ? nextHref : prevHref
        if (to) { e.preventDefault(); router.push(to, { scroll: false }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, prevHref, nextHref])
  // Aktuelle Person in der Liste sichtbar halten
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [currentId])
  // Nur die beiden Nachbarn vollständig vorladen (Banner und Register-Inhalt), damit Alt+↑/↓ ohne Wartezeit wechselt
  // (PRD §31) – nicht die ganze Liste (Serverlast). Erst im Leerlauf, damit die aktuelle Akte Vorrang hat.
  // Jede Aktualisierung (Live-Update, eigene Aktion) verwirft den Vorrat; dann verzögert neu laden, nie veraltet anzeigen.
  useEffect(() => {
    let alive = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const load = (h: string) => router.prefetch(h, {
      kind: 'full' as NonNullable<Parameters<ReturnType<typeof useRouter>['prefetch']>[1]>['kind'],
      onInvalidate: () => { if (alive) timers.push(setTimeout(() => { if (alive && document.visibilityState === 'visible') load(h) }, 3000)) },
    })
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const id = ric(() => { if (!alive) return; if (nextHref) load(nextHref); if (prevHref) load(prevHref) })
    return () => { alive = false; cancel(id); timers.forEach(clearTimeout) }
  }, [router, prevHref, nextHref])
  const links = () => [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a.res') ?? [])]
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.altKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const all = links()
    const i = all.indexOf(document.activeElement as HTMLAnchorElement)
    if (i < 0) return
    e.preventDefault()
    if (e.key === 'ArrowUp' && i === 0) return ref.current?.focus()
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    all[j]?.focus()
  }
  return (
    <aside className="panel" aria-label={t('residents.list.title')}>
      <div className="list-head">
        <div className="row"><span className="lbl">{pick ? t(pick === 'vitals' ? 'residents.list.pickVitals' : 'residents.list.pickNotes') : t('residents.list.title')}</span><span className="small muted">{t('residents.list.count', { n: list.length, total: rows.length })}</span></div>
        <TextField ref={ref} type="search" placeholder={t('residents.list.filter')} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('residents.list.filter')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); links()[0]?.focus() }
            else if (e.key === 'Enter' && list.length && needle) { e.preventDefault(); router.push(href(list[0].id), { scroll: false }); setQ('') }
            else if (e.key === 'Escape' && q) { e.preventDefault(); setQ('') }
          }} />
      </div>
      <ul className="reslist" ref={listRef} onKeyDown={onListKey}>
        {list.length ? list.map((r) => (
          <li key={r.id}>
            <Link className="res" href={href(r.id)} scroll={false} aria-current={r.id === currentId ? 'true' : 'false'}>
              <span className="room">{r.room}</span>
              <span style={{ minWidth: 0 }}>
                <div className="nm">{r.name}{r.changed && <><i className="chg" title={t('residents.list.changed')} /><span className="sr-only">, {t('residents.list.changed')}</span></>}</div>
                <div className="meta">{r.meta}</div>
              </span>
              <span className="counts">
                {/* Zahlen mit Bedeutung für Screenreader (title allein wird nicht zuverlässig vorgelesen) */}
                {r.over > 0 && <span className="pill crit" title={t('residents.list.overdue')}><span aria-hidden="true">{r.over}</span><span className="sr-only">{r.over} {t('residents.list.overdue')}</span></span>}
                <span className={'pill' + (r.open ? '' : ' ok')} title={t('residents.list.openToday')}><span aria-hidden="true">{r.open || '✓'}</span><span className="sr-only">{r.open} {t('residents.list.openToday')}</span></span>
              </span>
            </Link>
          </li>
        )) : <li className="small muted" style={{ padding: 12 }}>{t('residents.list.none')}</li>}
      </ul>
      <div className="list-foot">
        <span><i style={{ background: 'var(--crit-soft)', border: '1px solid var(--crit)' }} />{t('residents.list.overdue')}</span>
        <span><i style={{ background: 'var(--sunken)', border: '1px solid var(--line-strong)' }} />{t('residents.list.openToday')}</span>
        <span className="res-keys"><kbd>Alt</kbd> <kbd>↑</kbd><kbd>↓</kbd> {t('residents.list.keysHint')}</span>
      </div>
    </aside>
  )
}

export function Workspace({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  // Tablet: Liste als Zimmerleiste mit Schublade (Shell, PRD §29)
  return <ResidentWorkspace detail={path.split('/').length > 2}>{children}</ResidentWorkspace>
}
