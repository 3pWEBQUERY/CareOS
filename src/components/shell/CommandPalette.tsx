'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { IconSearch } from '@/components/icons'

export type PalItem = { group: string; label: string; hint?: string; href: string; keywords?: string }

const PER_GROUP = 8
const MAX = 40
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Rang eines Treffers: 0 = Label beginnt mit der Eingabe, 1 = ein Wort beginnt damit, 2 = sonst enthalten. */
function rank(i: PalItem, needle: string) {
  if (!needle) return 2
  const l = norm(i.label)
  if (l.startsWith(needle)) return 0
  if (l.split(/[\s·,:/()-]+/).some((w) => w.startsWith(needle)) || norm(i.keywords ?? '').split(/\s+/).includes(needle)) return 1
  return 2
}

/**
 * Globale Suche / Command Palette (PRD §24). Ctrl/⌘ K öffnet, "/" fokussiert Listenfilter.
 * Statische Ziele kommen vom Server, Treffer zu Bewohnenden, Dokumenten, Personen und Aufgaben live aus /api/search.
 * Treffer sind nach Art gruppiert; die Gruppe mit dem besten Treffer steht oben.
 */
export function CommandPalette({ items }: { items: PalItem[] }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [remote, setRemote] = useState<PalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [mac, setMac] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevFocus = useRef<Element | null>(null)

  const show = useCallback(() => {
    prevFocus.current = document.activeElement
    setQ('')
    setIdx(0)
    setRemote([])
    setOpen(true)
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    ;(prevFocus.current as HTMLElement | null)?.focus?.()
  }, [])

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform))
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      }
    }
    const onOpen = () => show()
    window.addEventListener('keydown', onKey)
    window.addEventListener('careos:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('careos:palette', onOpen)
    }
  }, [show])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setRemote([])
      setLoading(false)
      return
    }
    const ctl = new AbortController()
    setLoading(true)
    const id = setTimeout(() => {
      fetch('/api/search?q=' + encodeURIComponent(q.trim()), { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: PalItem[] }) => { setRemote(d.items); setLoading(false) })
        .catch(() => {})
    }, 140)
    return () => {
      clearTimeout(id)
      ctl.abort()
    }
  }, [q, open])

  const needle = norm(q.trim())
  const local = items.filter((i) => !needle || norm(i.label + ' ' + (i.hint ?? '') + ' ' + (i.keywords ?? '') + ' ' + i.group).includes(needle))
  const seen = new Set<string>()
  const merged = [...local, ...remote].filter((i) => (seen.has(i.href + i.label) ? false : (seen.add(i.href + i.label), true)))
  // Gruppieren: Reihenfolge der Gruppen nach bestem Rang, bei Gleichstand nach erstem Auftreten.
  const groupMap = new Map<string, { name: string; best: number; first: number; list: { i: PalItem; r: number }[] }>()
  merged.forEach((i, n) => {
    const r = rank(i, needle)
    const g = groupMap.get(i.group) ?? { name: i.group, best: 3, first: n, list: [] }
    g.best = Math.min(g.best, r)
    g.list.push({ i, r })
    groupMap.set(i.group, g)
  })
  let budget = MAX
  const groups = [...groupMap.values()]
    .sort((a, b) => a.best - b.best || a.first - b.first)
    .map((g) => {
      const list = g.list.sort((a, b) => a.r - b.r).slice(0, Math.min(PER_GROUP, budget)).map((x) => x.i)
      budget -= list.length
      return { name: g.name, list }
    })
    .filter((g) => g.list.length)
  const flat = groups.flatMap((g) => g.list)
  const cur = Math.min(idx, Math.max(0, flat.length - 1))

  useEffect(() => {
    if (open) document.getElementById('po' + cur)?.scrollIntoView({ block: 'nearest' })
  }, [cur, open])

  function run(i: PalItem | undefined) {
    if (!i) return
    setOpen(false)
    router.push(i.href)
  }

  let n = -1
  return (
    <>
      <button className="search-btn" type="button" onClick={show} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
        <IconSearch />
        <span>{t('common.palette.button')}</span>
        <kbd aria-hidden="true">{mac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      {open && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
          <div className="pal" role="dialog" aria-modal="true" aria-label={t('common.palette.label')}>
            {/* raw-field-ok: Suchfeld der Befehlspalette (eigenes Combobox-Muster mit Ergebnisliste) */}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setIdx(0) }}
              placeholder={t('common.palette.placeholder')}
              aria-label={t('common.palette.label')}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="pall"
              aria-activedescendant={flat.length ? 'po' + cur : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(flat.length ? (cur + 1) % flat.length : 0) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(flat.length ? (cur - 1 + flat.length) % flat.length : 0) }
                else if (e.key === 'PageDown') { e.preventDefault(); setIdx(Math.min(flat.length - 1, cur + 8)) }
                else if (e.key === 'PageUp') { e.preventDefault(); setIdx(Math.max(0, cur - 8)) }
                else if (e.key === 'Enter') { e.preventDefault(); run(flat[cur]) }
                else if (e.key === 'Escape') { e.preventDefault(); hide() }
                else if (e.key === 'Tab') e.preventDefault() // Fokus bleibt im Dialog
              }}
            />
            <ul id="pall" role="listbox" aria-label={t('common.palette.label')} aria-busy={loading || undefined}>
              {groups.map((g, gi) => (
                <Fragment key={g.name}>
                  <li role="presentation" className="pal-grp" id={'pg' + gi} aria-hidden="true">{g.name}</li>
                  {g.list.map((i) => {
                    n += 1
                    const k = n
                    return (
                      <li key={i.href + i.label} id={'po' + k} role="option" aria-selected={k === cur} aria-describedby={'pg' + gi} onMouseMove={() => k !== cur && setIdx(k)} onClick={() => run(i)}>
                        <span className="pal-lbl">{i.label}{i.hint && <span className="k"> · {i.hint}</span>}</span>
                      </li>
                    )
                  })}
                </Fragment>
              ))}
            </ul>
            {!flat.length && (
              <div className="pal-empty" role="status">
                {loading ? t('common.loading') : <><strong>{t('common.palette.empty')}</strong><span>{t('common.palette.emptyHint')}</span></>}
              </div>
            )}
            <div className="palfoot">
              <span>{t('common.palette.hint')}</span>
              <span className="sr-only" role="status" aria-live="polite">{needle && !loading ? t('common.palette.count', { n: flat.length }) : ''}</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
