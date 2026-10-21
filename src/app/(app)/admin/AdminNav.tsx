'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Linke Unternavigation von CareOS Admin. Auf dem Handy nur auf der Übersicht sichtbar. */
export function AdminWorkspace({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  return <div className="workspace" data-detail={path !== '/admin' ? 'true' : undefined}>{children}</div>
}

export function AdminNav({ title, items }: { title: string; items: { href: string; label: string; hint: string }[] }) {
  const path = usePathname()
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/'))
  return (
    <aside className="panel" aria-label={title}>
      <div className="list-head"><span className="lbl">{title}</span></div>
      <nav style={{ overflow: 'auto', minHeight: 0 }}>
        <ul className="menu">
          {items.map((it) => {
            const on = active(it.href)
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  aria-current={on ? 'page' : undefined}
                  style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, minHeight: 40, ...(on ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : {}) }}
                >
                  <span style={{ fontWeight: 500 }}>{it.label}</span>
                  <span className="small" style={{ color: on ? 'var(--accent)' : 'var(--fg-3)' }}>{it.hint}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
