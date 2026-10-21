'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function ResidentTabs({ base, tabs, label }: { base: string; tabs: { slug: string; label: string; badge?: React.ReactNode }[]; label: string }) {
  const path = usePathname()
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => {
        const href = t.slug ? `${base}/${t.slug}` : base
        const active = t.slug ? path.startsWith(href) : path === base
        return (
          <Link key={t.slug} href={href} aria-current={active ? 'page' : undefined} scroll={false}>
            {t.label}
            {t.badge}
          </Link>
        )
      })}
    </nav>
  )
}
