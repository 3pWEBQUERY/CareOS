'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IconChat, IconDocs, IconHome, IconSchedule } from '@/components/icons'

export type PortalNavItem = { href: string; label: string; icon: 'home' | 'chat' | 'schedule' | 'docs' | 'account'; badge?: number; badgeLabel?: string }

function IconAccount({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="7" r="3.25" />
      <path d="M3.5 17c.6-3.2 3.2-5 6.5-5s5.9 1.8 6.5 5" strokeLinecap="round" />
    </svg>
  )
}

const ICONS = { home: IconHome, chat: IconChat, schedule: IconSchedule, docs: IconDocs, account: IconAccount }

/** Navigation des Portals: Register oben (Desktop), Leiste unten (Mobile, Daumenbereich). */
export function PortalNav({ items, label }: { items: PortalNavItem[]; label: string }) {
  const path = usePathname()
  const active = (href: string) => (href === '/portal' ? path === '/portal' || path === '/portal/updates' || path === '/portal/appointments' : path === href || path.startsWith(href + '/'))
  return (
    <nav className="portal-nav" aria-label={label} style={{ ['--n' as string]: items.length }}>
      {items.map((it) => {
        const Icon = ICONS[it.icon]
        return (
          <Link key={it.href} href={it.href} aria-current={active(it.href) ? 'page' : undefined}>
            <Icon size={20} />
            <span>{it.label}</span>
            {!!it.badge && <span className="badge"><span aria-hidden="true">{it.badge}</span><span className="sr-only">{it.badge} {it.badgeLabel}</span></span>}
          </Link>
        )
      })}
    </nav>
  )
}
