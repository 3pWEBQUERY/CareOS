import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { directory } from '@/lib/people'
import { PeopleDirectory } from './PeopleDirectory'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('people.title')} · ${t('nav.team')}` }
}

/** Personenverzeichnis (PRD §55): Suche, Bereich, Dienst heute. Filtern geschieht ohne Server-Rundgang. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; unit?: string; f?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('team.read')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const [rows, units] = await Promise.all([
    directory(ctx),
    db.unit.findMany({ where: { orgId: ctx.org.id }, select: { id: true, name: true, location: { select: { name: true } } }, orderBy: [{ location: { name: 'asc' } }, { name: 'asc' }] }),
  ])
  const schedule = ctx.can('schedule.read')
  const onDuty = rows.filter((r) => r.today?.kind === 'shift' && r.today.running).length

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <Link href="/team" className="lbl" style={{ textDecoration: 'none' }}>{t('people.label')}</Link>
          <h1>{t('people.title')}</h1>
          <p className="sub">{schedule ? t('people.subOnDuty', { n: rows.length, on: onDuty }) : t('people.sub', { n: rows.length })}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <PeopleDirectory
            rows={rows}
            units={units.map((u) => ({ id: u.id, name: u.name, group: u.location.name }))}
            schedule={schedule}
            initial={{ q: sp.q ?? '', unit: sp.unit ?? '', f: sp.f === 'now' || sp.f === 'today' ? sp.f : '' }}
          />
        </div>
      </div>
    </main>
  )
}
