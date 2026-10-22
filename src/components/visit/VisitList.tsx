'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { splitQuestion, useConfirm } from '@/components/ui/ConfirmDialog'
import type { VisitNavDto, VisitRosterDto } from './types'
import { Select } from '@/components/ui/fields'

/** Ungespeicherte Erfassung (eine pro Seite): Personenwechsel fragt vorher nach (PRD §32). */
const dirty = { on: false, name: '' }
export function setVisitDirty(on: boolean, name = '') {
  dirty.on = on
  dirty.name = name
}

/** Navigation mit Rückfrage, falls die Erfassung der aktuellen Person noch nicht abgeschlossen ist. */
export function useGuardedNav() {
  const t = useT()
  const router = useRouter()
  const [ask, dialog] = useConfirm()
  const go = useCallback(async (href: string) => {
    if (dirty.on && !(await ask({ ...splitQuestion(t('visit.capture.discard', { name: dirty.name })), confirmLabel: t('visit.capture.discardOk'), danger: true }))) return
    setVisitDirty(false)
    router.push(href, { scroll: false })
  }, [ask, router, t])
  return [go, dialog] as const
}

/**
 * Liste der Personen der Visite (links bzw. oben): Zimmer, Name, Termin, offene Fragen, Status.
 * Alt+↑/↓ wechselt die Person wie in der Akte; «Person hinzufügen» für ungeplante Visiten.
 */
export function VisitList({ rows, currentId, residents, nav }: {
  rows: VisitRosterDto[]
  currentId: string | null
  residents: { id: string; name: string; room: string | null }[]
  nav: VisitNavDto
}) {
  const t = useT()
  const router = useRouter()
  const [go, dialog] = useGuardedNav()
  const listRef = useRef<HTMLUListElement>(null)
  const done = rows.filter((r) => r.done).length
  const others = residents.filter((r) => !rows.some((x) => x.id === r.id))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
      const to = e.key === 'ArrowDown' ? nav.next?.href : nav.prev
      if (!to) return
      e.preventDefault()
      void go(to)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, nav])
  useEffect(() => {
    if (nav.next) router.prefetch(nav.next.href)
    if (nav.prev) router.prefetch(nav.prev)
    listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [router, nav, currentId])

  return (
    <nav className="visit-list" aria-label={t('visit.list.label')}>
      <div className="visit-list-head">
        <span className="lbl">{t('visit.list.label')}</span>
        {rows.length > 0 && <span className="small muted">{t('visit.progress', { done, total: rows.length })}</span>}
      </div>
      {rows.length ? (
        <ul ref={listRef}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link className="res" href={r.href} scroll={false} aria-current={r.id === currentId ? 'page' : undefined}
                onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); void go(r.href) }}>
                <span className="room">{r.room ?? '–'}</span>
                <span className="grow">
                  <span className="nm">{r.name}</span>
                  <span className="meta">
                    {[r.at && t('visit.list.at', { time: r.at }), r.questions ? t('visit.list.questions', { n: r.questions }) : null].filter(Boolean).join(' · ') || ' '}
                  </span>
                </span>
                {r.done
                  ? <span className="tag ok" title={t('visit.list.done')}><span aria-hidden="true">✓</span><span className="sr-only">{t('visit.list.done')}</span></span>
                  : <span className="sr-only">{t('visit.list.open')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted visit-list-empty">{t('visit.list.empty')}</p>
      )}
      {others.length > 0 && (
        <label className="visit-list-add">
          <span className="sr-only">{t('visit.list.add')}</span>
          <Select value="" onChange={(e) => { if (e.target.value) void go(`/tasks/visit?r=${e.target.value}`) }}>
            <option value="">{t('visit.list.add')}</option>
            {others.map((r) => <option key={r.id} value={r.id}>{[r.room, r.name].filter(Boolean).join(' ')}</option>)}
          </Select>
        </label>
      )}
      <p className="small muted visit-keys">{t('visit.keys')}</p>
      {dialog}
    </nav>
  )
}

/** Link mit derselben Rückfrage bei ungespeicherter Erfassung (Beenden, Akte öffnen). */
export function GuardedLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const [go, dialog] = useGuardedNav()
  return (
    <>
      <Link href={href} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); void go(href) }}>{children}</Link>
      {dialog}
    </>
  )
}
