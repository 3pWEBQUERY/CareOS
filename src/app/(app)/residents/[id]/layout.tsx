import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { ResidentTabs } from '@/components/residents/ResidentTabs'
import { addDays, addMinutes, age, fmtDbDate, startOfDay } from '@/lib/time'
import { OPEN_STATUSES } from '@/lib/tasks'
import { abnormalKeys, mergeLimits } from '@/lib/vitals'
import { audit } from '@/lib/audit'

/** Bewohnerakte: Kopfbereich mit unmittelbar relevanten Informationen (PRD §8.1) und Registern (§8.2). */
export default async function ResidentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const now = new Date()
  const [nurse, over, lastVital, limits, openWounds] = await Promise.all([
    r.primaryNurseId ? db.user.findUnique({ where: { id: r.primaryNurseId }, select: { firstName: true, lastName: true, jobTitle: true } }) : null,
    db.task.count({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addMinutes(now, -15) } } }),
    db.vitalSign.findFirst({ where: { residentId: r.id, at: { gte: addDays(now, -1) } }, orderBy: { at: 'desc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
    db.wound.count({ where: { residentId: r.id, status: { not: 'closed' } } }),
  ])
  // Lesezugriffe auf Gesundheitsdaten werden protokolliert (höchstens einmal pro Sitzung und Stunde).
  const recent = await db.auditLog.findFirst({ where: { sessionId: ctx.sessionId, action: 'resident.view', entityId: r.id, at: { gte: addMinutes(now, -60) } }, select: { id: true } })
  if (!recent) await audit(ctx, { action: 'resident.view', entityType: 'Resident', entityId: r.id })

  const abnormal = abnormalKeys(lastVital, mergeLimits(limits, r.id)).length
  const base = `/residents/${r.id}`
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p, { unitId: r.unitId, locationId: r.unit.locationId })
  const tabs = [
    { slug: '', label: t('residents.tabs.overview') },
    { slug: 'timeline', label: t('residents.tabs.timeline') },
    { slug: 'day', label: t('residents.tabs.day'), badge: over ? <span className="pill crit">{over}</span> : null },
    { slug: 'notes', label: t('residents.tabs.notes') },
    { slug: 'careplan', label: t('residents.tabs.careplan') },
    ...(can('resident.medication.read') ? [{ slug: 'meds', label: t('residents.tabs.meds') }] : []),
    { slug: 'vitals', label: t('residents.tabs.vitals'), badge: abnormal ? <span className="pill crit">!</span> : null },
    { slug: 'assessments', label: t('residents.tabs.assessments') },
    { slug: 'wounds', label: t('residents.tabs.wounds'), badge: openWounds ? <span className="pill">{openWounds}</span> : null },
    { slug: 'nutrition', label: t('residents.tabs.nutrition') },
    { slug: 'appointments', label: t('residents.tabs.appointments') },
    { slug: 'files', label: t('residents.tabs.files') },
    { slug: 'contacts', label: t('residents.tabs.contacts') },
    { slug: 'history', label: t('residents.tabs.history') },
  ]

  return (
    <main className="panel main">
      <section className="banner">
        <div className="who">
          <h1>{r.lastName} <span>{r.firstName}</span></h1>
          <div className="facts">
            <Fact l={t('residents.banner.born')} v={`${fmtDbDate(r.birthDate, locale)} (${age(r.birthDate)} ${t('common.years')})`} mono />
            <Fact l={t('residents.banner.room')} v={r.room?.number ?? '–'} mono />
            {r.careLevel != null && <Fact l={t('residents.banner.careLevel')} v={String(r.careLevel)} mono />}
            {r.diet && <Fact l={t('residents.banner.diet')} v={r.diet} />}
            {r.physician && <Fact l={t('residents.banner.physician')} v={r.physician} />}
            {nurse && <Fact l={t('residents.banner.primaryNurse')} v={`${nurse.firstName.charAt(0)}. ${nurse.lastName}${nurse.jobTitle ? ', ' + nurse.jobTitle : ''}`} />}
          </div>
        </div>
        <div className="flags">
          {r.status === 'absent' && <span className="flag info">{t('residents.banner.absent')}</span>}
          {r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>)}
          {r.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
          <span className={'flag ' + (r.rea === 'yes' ? 'rea-yes' : r.rea === 'no' ? 'rea-no' : '')}>{t(r.rea === 'yes' ? 'residents.banner.reaYes' : r.rea === 'no' ? 'residents.banner.reaNo' : 'residents.banner.reaUnknown')}</span>
        </div>
      </section>
      <ResidentTabs base={base} tabs={tabs} label={t('residents.tabs.label')} />
      <div className="scroll">
        <div className="tabpanel">{children}</div>
      </div>
    </main>
  )
}

function Fact({ l, v, mono }: { l: string; v: string; mono?: boolean }) {
  return (
    <div className="fact">
      <span className="lbl">{l}</span>
      <span className={'v' + (mono ? ' mono' : '')}>{v}</span>
    </div>
  )
}
