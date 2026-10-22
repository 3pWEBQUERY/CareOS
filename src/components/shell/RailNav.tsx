'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as I from '@/components/icons'

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; group: number }
const ICONS = {
  home: I.IconHome, residents: I.IconResidents, tasks: I.IconTasks, handover: I.IconHandover, schedule: I.IconSchedule,
  team: I.IconTeam, chat: I.IconChat, learn: I.IconLearn, docs: I.IconDocs, insights: I.IconInsights, quality: I.IconQuality, admin: I.IconAdmin,
}

export const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'))

export function RailNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname()
  return (
    <nav className="panel rail" aria-label={label}>
      {items.map((it, i) => {
        const Icon = ICONS[it.icon]
        const sep = i > 0 && items[i - 1].group !== it.group
        return (
          <span key={it.href} style={{ display: 'contents' }}>
            {sep && <hr />}
            {/* Standard-Vorladen (bis zum Skeleton der Zielansicht): sofortiger Wechsel ohne alle Ansichten
                bei jedem Seitenaufruf und jedem Live-Update vollständig auf dem Server zu rendern (Last, Aktualität). */}
            <Link href={it.href} aria-current={isActive(path, it.href) ? 'page' : undefined}>
              <Icon />
              {it.label}
              {!!it.badge && <span className="badge">{it.badge}</span>}
            </Link>
          </span>
        )
      })}
    </nav>
  )
}

export function BottomNav({ items, more, moreLabel, label, quick }: { items: NavItem[]; more: NavItem[]; moreLabel: string; label?: string; quick: React.ReactNode }) {
  const path = usePathname()
  const main = ['/', '/residents', '/tasks', '/team']
  const shown = main.map((h) => items.find((i) => i.href === h)).filter(Boolean) as NavItem[]
  const moreActive = more.some((m) => isActive(path, m.href))
  const cell = (it: NavItem) => {
    const Icon = ICONS[it.icon]
    return (
      <Link key={it.href} href={it.href} aria-current={isActive(path, it.href) ? 'page' : undefined}>
        <Icon size={22} />
        {it.label}
        {!!it.badge && <span className="badge" style={{ position: 'absolute', top: 4, right: '22%' }}>{it.badge}</span>}
      </Link>
    )
  }
  return (
    <nav className="bottom-nav" aria-label={label ?? moreLabel} style={{ gridTemplateColumns: `repeat(${shown.length + 2}, 1fr)` }}>
      {shown.slice(0, 2).map(cell)}
      <div className="fab-slot">{quick}</div>
      {shown.slice(2).map(cell)}
      <Link href="/more" aria-current={path === '/more' || moreActive ? 'page' : undefined}>
        <I.IconMore size={22} />
        {moreLabel}
      </Link>
    </nav>
  )
}
