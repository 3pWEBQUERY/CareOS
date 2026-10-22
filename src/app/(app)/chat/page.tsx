import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { usersWithPermission } from '@/lib/notify'
import { fmtRel, hm, sameDay } from '@/lib/time'
import { ChatView, type ChatMsg } from './ChatView'
import { NewConversation } from './NewConversation'

export const metadata = { title: 'Chat' }

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string; with?: string }> }) {
  const ctx = await getCtx()
  const { t, user, org } = ctx
  if (!ctx.can('chat.use')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const canClinical = ctx.can('chat.clinical')
  const now = new Date()

  // Direktnachricht aus globaler Suche oder Profil: bestehende Unterhaltung öffnen oder anlegen.
  if (sp.with && sp.with !== user.id) {
    const other = await db.user.findFirst({ where: { id: sp.with, orgId: org.id, active: true }, select: { id: true } })
    if (other) {
      const existing = await db.conversation.findFirst({
        where: { orgId: org.id, kind: 'direct', clinical: false, AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: other.id } } }] },
        include: { _count: { select: { members: true } } },
        orderBy: { lastMessageAt: 'desc' },
      })
      let id = existing && existing._count.members === 2 ? existing.id : null
      if (!id) {
        const conv = await db.conversation.create({
          data: { orgId: org.id, kind: 'direct', createdById: user.id, lastMessageAt: now, members: { create: [{ userId: user.id, lastReadAt: now }, { userId: other.id, lastReadAt: now }] } },
        })
        id = conv.id
      }
      redirect(`/chat?c=${id}`)
    }
  }

  const memberships = await db.conversationMember.findMany({
    where: { userId: user.id, conversation: { orgId: org.id, ...(canClinical ? {} : { clinical: false }) } },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true } } } },
          messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, include: { author: { select: { firstName: true } } } },
        },
      },
    },
  })
  memberships.sort((a, b) => b.conversation.lastMessageAt.getTime() - a.conversation.lastMessageAt.getTime())
  const unread = await Promise.all(
    memberships.map((m) => db.message.count({ where: { conversationId: m.conversationId, createdAt: { gt: m.lastReadAt }, authorId: { not: user.id }, deletedAt: null } })),
  )

  const title = (c: (typeof memberships)[number]['conversation']) => {
    if (c.kind === 'direct') {
      const o = c.members.find((m) => m.userId !== user.id)?.user
      return o ? `${o.firstName} ${o.lastName}` : t('team.chat.onlyYou')
    }
    return c.name || c.members.filter((m) => m.userId !== user.id).map((m) => m.user.firstName).join(', ')
  }
  const initials = (c: (typeof memberships)[number]['conversation']) =>
    c.kind === 'direct' ? c.members.find((m) => m.userId !== user.id)?.user.initials ?? '–' : (c.name || '#').replace(/[^A-Za-zÀ-ž0-9]/g, '').slice(0, 2).toUpperCase() || '#'

  const sel = sp.c ? memberships.find((m) => m.conversationId === sp.c) ?? null : null
  const rel = (d: Date) => (sameDay(d, now) ? hm(d) : fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now))

  // Kandidaten für neue Unterhaltungen (nur Mitarbeitende der Organisation, keine Bewohnerdaten).
  const [people, teams, clinicalIds] = await Promise.all([
    db.user.findMany({ where: { orgId: org.id, active: true, id: { not: user.id } }, select: { id: true, firstName: true, lastName: true, jobTitle: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    db.team.findMany({ where: { orgId: org.id, members: { some: { userId: user.id } } }, select: { id: true, name: true } }),
    canClinical ? usersWithPermission(org.id, 'chat.clinical') : Promise.resolve([] as string[]),
  ])
  const personOpts = people.map((p) => ({ id: p.id, name: `${p.lastName} ${p.firstName}`, hint: p.jobTitle ?? '', clinical: clinicalIds.includes(p.id) }))

  let view: React.ReactNode = null
  if (sel) {
    const c = sel.conversation
    const raw = await db.message.findMany({
      where: { conversationId: c.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { reactions: true },
    })
    raw.reverse()
    const fileIds = [...new Set(raw.flatMap((m) => (m.deletedAt ? [] : m.fileIds)))]
    const files = fileIds.length ? await db.fileObject.findMany({ where: { id: { in: fileIds }, orgId: org.id }, select: { id: true, filename: true } }) : []
    const fileName = new Map(files.map((f) => [f.id, f.filename]))
    const byId = new Map(c.members.map((m) => [m.userId, m.user]))
    const missing = [...new Set(raw.map((m) => m.authorId).filter((id) => !byId.has(id)))]
    if (missing.length) for (const u of await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true } })) byId.set(u.id, u)

    const msgs: ChatMsg[] = raw.map((m) => {
      const a = byId.get(m.authorId)
      const counts = new Map<string, { n: number; mine: boolean }>()
      for (const r of m.reactions) {
        const e = counts.get(r.emoji) ?? { n: 0, mine: false }
        e.n++
        if (r.userId === user.id) e.mine = true
        counts.set(r.emoji, e)
      }
      return {
        id: m.id,
        authorId: m.authorId,
        author: a ? `${a.firstName} ${a.lastName}` : '–',
        initials: a?.initials ?? '–',
        body: m.deletedAt ? '' : m.body,
        at: m.createdAt.toISOString(),
        time: hm(m.createdAt),
        edited: !!m.editedAt,
        deleted: !!m.deletedAt,
        mine: m.authorId === user.id,
        files: m.deletedAt ? [] : m.fileIds.map((id) => ({ id, name: fileName.get(id) ?? id })),
        reactions: m.deletedAt ? [] : [...counts.entries()].map(([symbol, v]) => ({ symbol, ...v })),
      }
    })
    const memberIds = new Set(c.members.map((m) => m.userId))
    view = (
      <ChatView
        key={c.id}
        conv={{ id: c.id, kind: c.kind, title: title(c), clinical: c.clinical, muted: sel.muted, lastMessageAt: c.lastMessageAt.toISOString() }}
        me={user.id}
        members={c.members.map((m) => ({ id: m.userId, name: `${m.user.firstName} ${m.user.lastName}`, initials: m.user.initials, job: m.user.jobTitle ?? '' })).sort((a, b) => a.name.localeCompare(b.name))}
        candidates={personOpts.filter((p) => !memberIds.has(p.id) && (!c.clinical || p.clinical))}
        messages={msgs}
        wasUnread={c.lastMessageAt > sel.lastReadAt}
        lastReadAt={sel.lastReadAt.toISOString()}
      />
    )
  }

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('team.chat.label')}</span>
          <h1>{t('team.chat.title')}</h1>
        </div>
        <NewConversation people={personOpts} teams={teams} canClinical={canClinical} />
      </div>
      <div className="chat" data-open={sel ? 'true' : undefined}>
        <nav className="chat-list" aria-label={t('team.chat.list')}>
          {memberships.length ? (
            <ul className="list">
              {memberships.map((m, i) => {
                const c = m.conversation
                const last = c.messages[0]
                const n = unread[i]
                return (
                  <li key={c.id}>
                    <Link className={'li' + (n ? ' unread' : '')} href={`/chat?c=${c.id}`} aria-current={sel?.conversationId === c.id ? 'page' : undefined}>
                      <span className={'av' + (c.kind === 'direct' ? '' : ' muted')}>{initials(c)}</span>
                      <div className="grow">
                        <div className="ellipsis">{title(c)}</div>
                        <div className="small muted ellipsis" style={{ fontWeight: 400 }}>
                          {last ? `${last.authorId === user.id ? t('team.chat.you') : last.author.firstName}: ${c.clinical ? t('team.chat.clinicalPreview') : last.body || t('team.chat.attachment')}` : t('team.chat.noMessages')}
                        </div>
                        <div className="row" style={{ gap: 4, marginTop: 3 }}>
                          {c.kind !== 'direct' && <span className="tag">{t('team.chat.kinds.' + c.kind)}</span>}
                          {c.clinical && <span className="tag violet">{t('team.chat.clinical')}</span>}
                          {m.muted && <span className="tag outline">{t('team.chat.muted')}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <time className="small muted mono nowrap">{rel(c.lastMessageAt)}</time>
                        {n > 0 && <span className="pill accent" aria-label={t('team.chat.unread', { n })}>{n}</span>}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="tabpanel"><p className="empty" style={{ margin: 0 }}>{t('team.chat.empty')}</p></div>
          )}
        </nav>
        <section className="chat-main" aria-label={sel ? title(sel.conversation) : t('team.chat.title')}>
          {view ?? (
            <div className="tabpanel" style={{ flex: 1, justifyContent: 'center' }}>
              <div className="empty"><strong>{t('team.chat.pickTitle')}</strong><span className="small">{t('team.chat.pick')}</span></div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
