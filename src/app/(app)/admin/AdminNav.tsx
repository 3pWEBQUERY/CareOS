'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Arbeitsbereich von CareOS Admin: Unternavigation links, auf Tablet hoch und Handy als Leiste oben. */
export function AdminWorkspace({ children }: { children: React.ReactNode }) {
  return <div className="workspace adm-ws">{children}</div>
}

export function AdminNav({ title, items }: { title: string; items: { href: string; label: string; hint: string }[] }) {
  const path = usePathname()
  const nav = useRef<HTMLElement>(null)
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/'))
  // Als Leiste: aktiven Bereich sichtbar halten
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    const box = nav.current
    if (!el || !box || box.scrollWidth <= box.clientWidth) return
    box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2
  }, [path])
  return (
    <aside className="panel adm-nav" aria-label={title}>
      <div className="list-head"><span className="lbl">{title}</span></div>
      <nav ref={nav} aria-label={title}>
        <ul className="menu">
          {items.map((it) => (
            <li key={it.href}>
              <Link href={it.href} aria-current={active(it.href) ? 'page' : undefined}>
                <span className="adm-nav-l">{it.label}</span>
                <span className="small adm-nav-h">{it.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
