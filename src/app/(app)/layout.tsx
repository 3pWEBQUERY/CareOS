import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { dictionary } from '@/i18n'
import { I18nProvider } from '@/i18n/client'
import { Brand } from '@/components/Brand'
import { Toaster } from '@/components/toast'
import { SwUpdateNotice } from '@/components/shell/SwUpdateNotice'
import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { Clock } from '@/components/shell/Clock'
import { UnitSwitcher } from '@/components/shell/UnitSwitcher'
import { RailNav, BottomNav, type NavItem } from '@/components/shell/RailNav'
import { CommandPalette, type PalItem } from '@/components/shell/CommandPalette'
import { Notifications } from '@/components/shell/Notifications'
import { LiveUpdates } from '@/components/shell/LiveUpdates'
import { QuickActions } from '@/components/shell/QuickActions'
import { currentShiftLabel } from '@/lib/shift'
import { overdueCount } from '@/lib/tasks'
import { enforceMfaSetup } from '@/lib/auth/mfa-gate'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  await enforceMfaSetup(ctx) // MFA-Pflicht der Organisation: bis zur Einrichtung nur Profil (PRD §33)
  const { t, user, org } = ctx
  const any = (prefix: string) => ctx.grants.some((g) => g.permissions.some((p) => p.startsWith(prefix)))

  const [unread, critical, overdue, unreadChats, residents, shift] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.notification.count({ where: { userId: user.id, readAt: null, priority: 'critical' } }),
    ctx.unit && ctx.canHere('task.read') ? overdueCount(ctx.unit.id) : Promise.resolve(0),
    ctx.can('chat.use') ? unreadConversations(user.id) : Promise.resolve(0),
    ctx.can('resident.read')
      ? db.resident.findMany({
          where: { orgId: org.id, unitId: { in: ctx.unitIds }, status: { in: ['active', 'absent'] } },
          select: { id: true, firstName: true, lastName: true, room: { select: { number: true } }, unit: { select: { name: true } } },
          orderBy: { lastName: 'asc' },
          take: 500,
        })
      : Promise.resolve([]),
    currentShiftLabel(ctx),
  ])

  const nav: NavItem[] = [
    { href: '/', label: t('nav.home'), icon: 'home', group: 0 },
    ...(ctx.can('resident.read') ? [{ href: '/residents', label: t('nav.residents'), icon: 'residents', group: 0 } as NavItem] : []),
    ...(ctx.can('task.read') ? [{ href: '/tasks', label: t('nav.tasks'), icon: 'tasks', group: 0, badge: overdue } as NavItem] : []),
    ...(ctx.can('handover.read') ? [{ href: '/handover', label: t('nav.handover'), icon: 'handover', group: 0 } as NavItem] : []),
    ...(ctx.can('schedule.read') ? [{ href: '/schedule', label: t('nav.schedule'), icon: 'schedule', group: 0 } as NavItem] : []),
    ...(ctx.can('team.read') ? [{ href: '/team', label: t('nav.team'), icon: 'team', group: 1 } as NavItem] : []),
    ...(ctx.can('chat.use') ? [{ href: '/chat', label: t('nav.chat'), icon: 'chat', group: 1, badge: unreadChats } as NavItem] : []),
    ...(ctx.can('learn.read') ? [{ href: '/learn', label: t('nav.learn'), icon: 'learn', group: 1 } as NavItem] : []),
    ...(ctx.can('docs.read') ? [{ href: '/docs', label: t('nav.docs'), icon: 'docs', group: 1 } as NavItem] : []),
    ...(ctx.can('insights.view') ? [{ href: '/insights', label: t('nav.insights'), icon: 'insights', group: 2 } as NavItem] : []),
    ...(ctx.can('quality.report') ? [{ href: '/quality', label: t('nav.quality'), icon: 'quality', group: 2 } as NavItem] : []),
    ...(any('admin.') ? [{ href: '/admin', label: t('nav.admin'), icon: 'admin', group: 2 } as NavItem] : []),
  ]
  const more = nav.filter((n) => !['/', '/residents', '/tasks', '/team'].includes(n.href))

  const palette: PalItem[] = [
    ...residents.map((r) => ({
      group: t('common.palette.groupResident'),
      label: `${r.lastName} ${r.firstName}`,
      hint: [r.room?.number && t('common.palette.room', { n: r.room.number }), r.unit.name].filter(Boolean).join(' · '),
      keywords: r.room?.number ?? '',
      href: `/residents/${r.id}`,
    })),
    ...nav.map((n) => ({ group: t('common.palette.groupView'), label: n.label, href: n.href })),
    ...(ctx.can('resident.medication.administer') ? [{ group: t('common.palette.groupAction'), label: t('nav.medround'), href: '/tasks/medround' }] : []),
    ...(ctx.can('quality.report') ? [{ group: t('common.palette.groupAction'), label: t('common.quick.incident'), href: '/quality/new' }] : []),
    ...(ctx.can('task.manage') ? [{ group: t('common.palette.groupAction'), label: t('common.quick.task'), href: '/tasks?new=1' }] : []),
    { group: t('common.palette.groupAction'), label: t('common.quick.document'), href: '/residents?pick=notes' },
    { group: t('common.palette.groupAction'), label: t('common.quick.vitals'), href: '/residents?pick=vitals' },
    { group: t('common.palette.groupView'), label: t('nav.profile'), href: '/profile' },
  ]

  const units = ctx.units.map((u) => ({ id: u.id, name: u.name, location: u.location.name }))
  const settings = (org.settings ?? {}) as { demo?: boolean }
  const residentCount = ctx.unit ? residents.filter((r) => r.unit.name === ctx.unit!.name).length : residents.length

  return (
    <I18nProvider locale={ctx.locale} terminology={ctx.terminology} messages={dictionary(ctx.locale)}>
      {/* Branding (Admin → Organisation): Akzentfarbe nur für die helle Darstellung, Wert ist validiert (#RRGGBB, Kontrast ≥ 4.5:1). */}
      {org.brandColor && /^#[0-9a-fA-F]{6}$/.test(org.brandColor) && (
        <style>{brandCss(org.brandColor)}</style>
      )}
      <a className="skip" href="#main">{t('common.skipToContent')}</a>
      <div className="app">
        <header className="topbar">
          <Link href="/" style={{ textDecoration: 'none' }} aria-label={`${org.brandName || 'CareOS'} – ${t('nav.home')}`}><Brand name={org.brandName} logoUrl={org.logoFileId ? `/api/files/${org.logoFileId}` : null} /></Link>
          <div className="ctx">
            <UnitSwitcher units={units} current={ctx.unit?.id ?? null} label={t('nav.areas')} />
            <span>{org.name}{ctx.unit ? ` · ${t('home.residentCount', { n: residentCount })}` : ''}</span>
          </div>
          <CommandPalette items={palette} />
          {shift && (
            <div className="shift" title={shift.mine ? t('home.myShift') : undefined}>
              <i className="dot" aria-hidden="true" />
              <span>{shift.name}</span> <span className="full mono">{shift.start}–{shift.end}</span>
            </div>
          )}
          <Clock />
          {settings.demo && <span className="demo" title={t('common.demoDataHint')}>{t('common.demoData')}</span>}
          <ThemeToggle />
          <Notifications unread={unread} critical={critical} />
          <Link className="me" href="/profile">
            <span className="av">{user.initials}</span>
            <div>{user.firstName.charAt(0)}. {user.lastName}<small>{user.jobTitle ?? ctx.roleNames[0] ?? ''}</small></div>
          </Link>
        </header>
        <RailNav items={nav} label={t('nav.mainNav')} />
        <div className="content" id="main">{children}</div>
      </div>
      <BottomNav items={nav} more={more} moreLabel={t('nav.more')} quick={<QuickActions canIncident={ctx.can('quality.report')} canTask={ctx.can('task.manage')} />} />
      <Toaster />
      <SwUpdateNotice />
      <LiveUpdates userId={user.id} />
    </I18nProvider>
  )
}

function brandCss(c: string) {
  const vars = `--accent:${c};--accent-hover:color-mix(in srgb, ${c} 82%, #000);--accent-soft:color-mix(in srgb, ${c} 14%, #fff)`
  return `:root[data-theme="light"]{${vars}}@media (prefers-color-scheme: light){:root[data-theme="system"]{${vars}}}`
}

async function unreadConversations(userId: string) {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "ConversationMember" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE m."userId" = ${userId} AND m.muted = false AND c."lastMessageAt" > m."lastReadAt"`
  return Number(rows[0]?.n ?? 0)
}
