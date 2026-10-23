import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { ResidentPager, ResidentTabs } from '@/components/residents/ResidentTabs'
import { addDays, addMinutes, age, fmtDate, fmtDbDate, startOfDay } from '@/lib/time'
import { openAbsences } from '@/lib/adt'
import { OPEN_STATUSES, overdueFilter } from '@/lib/tasks'
import { abnormalKeys, LIVE, mergeLimits } from '@/lib/vitals'
import { audit } from '@/lib/audit'
import { storageConfigured } from '@/lib/env'
import { PhotoEditor } from '@/components/residents/PhotoEditor'
import { ResidentPhoto } from '@/components/residents/ResidentPhoto'

/** Bewohnerakte: Kopfbereich mit unmittelbar relevanten Informationen (PRD §8.1) und Registern (§8.2). */
export default async function ResidentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const now = new Date()
  const listUnitIds = ctx.unit ? [ctx.unit.id] : ctx.unitIds
  const [peers, over, lastVital, limits, openWounds] = await Promise.all([
    // Reihenfolge wie in der Bewohnerliste (Zimmer, Name) für «vorherige/nächste Person»
    db.resident.findMany({ where: { orgId: ctx.org.id, unitId: { in: listUnitIds }, status: { in: ['active', 'absent'] } }, select: { id: true, lastName: true, firstName: true, room: { select: { number: true } } }, orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }] }),
    overdueFilter(ctx.org.id, now).then((w) => db.task.count({ where: { residentId: r.id, ...w } })),
    db.vitalSign.findFirst({ where: { residentId: r.id, ...LIVE, at: { gte: addDays(now, -1) } }, orderBy: { at: 'desc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
    db.wound.count({ where: { residentId: r.id, status: { not: 'closed' } } }),
  ])
  // Laufende Abwesenheit mit Grund und geplanter Rückkehr (PRD §43)
  const absence = r.status === 'absent' ? (await openAbsences([r.id])).get(r.id) ?? null : null
  const absentText = absence
    ? t(absence.expectedEnd ? 'residents.adt.bannerUntil' : 'residents.adt.banner', { date: fmtDate(absence.start, locale, { day: '2-digit', month: '2-digit' }), reason: absence.reason, until: absence.expectedEnd ? fmtDate(absence.expectedEnd, locale, { day: '2-digit', month: '2-digit' }) : '' })
    : t('residents.banner.absent')
  // Lesezugriffe auf Gesundheitsdaten werden protokolliert (höchstens einmal pro Sitzung und Stunde).
  // entityType zuerst: nutzt den Index (entityType, entityId) statt das ganze Protokoll zu durchsuchen (PRD §66)
  const recent = await db.auditLog.findFirst({ where: { entityType: 'Resident', entityId: r.id, sessionId: ctx.sessionId, action: 'resident.view', at: { gte: addMinutes(now, -60) } }, select: { id: true } })
  if (!recent) await audit(ctx, { action: 'resident.view', entityType: 'Resident', entityId: r.id })

  const pi = peers.findIndex((p) => p.id === r.id)
  const peer = (p: (typeof peers)[number] | undefined) => (p ? { id: p.id, label: `${p.room?.number ?? '–'} ${p.lastName} ${p.firstName}` } : null)
  const reaCls = r.rea === 'yes' ? 'rea-yes' : r.rea === 'no' ? 'rea-no' : ''
  const reaText = t(r.rea === 'yes' ? 'residents.banner.reaYes' : r.rea === 'no' ? 'residents.banner.reaNo' : 'residents.banner.reaUnknown')
  // Gesehen / Massnahme eingeleitet (Home, PRD §14): kein Hinweis mehr am Register
  const abnormal = lastVital?.reviewedAt ? 0 : abnormalKeys(lastVital, mergeLimits(limits, r.id)).length
  const base = `/residents/${r.id}`
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p, { unitId: r.unitId, locationId: r.unit.locationId })
  const tabs = [
    { slug: '', label: t('residents.tabs.overview') },
    { slug: 'timeline', label: t('residents.tabs.timeline') },
    { slug: 'day', label: t('residents.tabs.day'), badge: over ? <span className="pill crit">{over}</span> : null },
    { slug: 'bedside', label: t('residents.tabs.bedside') },
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
      <section className="banner rec-banner" aria-label={t('residents.rec.bannerLabel')}>
        <PhotoEditor
          residentId={r.id} photoId={r.photoFileId} name={`${r.lastName} ${r.firstName}`}
          who={`${r.lastName} ${r.firstName} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
          canEdit={!r.anonymisedAt && (can('resident.edit') || can('resident.careplan.edit'))} storage={storageConfigured()}
        />
        <div className="who">
          <h1>{r.lastName} <span>{r.firstName}</span></h1>
          <div className="facts">
            <Fact l={t('residents.banner.room')} v={r.room?.number ?? '–'} mono />
            <Fact l={t('residents.rec.age')} v={`${age(r.birthDate)} ${t('common.years')}`} title={`${t('residents.banner.born')} ${fmtDbDate(r.birthDate, locale)}`} mono />
            <Fact l={t('residents.banner.mobility')} v={r.mobility || '–'} />
            {r.diet && <Fact l={t('residents.banner.diet')} v={r.diet} />}
            {r.careLevel != null && <Fact l={t('residents.banner.careLevel')} v={String(r.careLevel)} mono cls="rec-opt" />}
          </div>
          {r.importantNotes && <p className="rec-note" title={r.importantNotes}><span className="lbl">{t('residents.rec.important')}</span> {r.importantNotes}</p>}
        </div>
        <div className="flags">
          {r.status === 'absent' && <a className="flag info" href={`/residents/${r.id}/history#stay`}>{absentText}</a>}
          {r.allergies.length ? r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>) : <span className="flag">{t('residents.banner.noAllergies')}</span>}
          {r.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
          <span className={'flag ' + reaCls}>{reaText}</span>
        </div>
        {peers.length > 1 && pi >= 0 && <ResidentPager prev={peer(peers[pi - 1])} next={peer(peers[pi + 1])} />}
      </section>
      <ResidentTabs
        base={base}
        tabs={tabs}
        label={t('residents.tabs.label')}
        ident={
          <>
            <ResidentPhoto residentId={r.id} photoId={r.photoFileId} name={`${r.lastName} ${r.firstName}`} size="xs" />
            <strong>{r.lastName} {r.firstName}</strong>
            <span className="mono">{r.room?.number ?? '–'}</span>
            <span className={'flag ' + reaCls}>{reaText}</span>
            {r.allergies.length > 0 && <span className="flag crit">{t('residents.list.allergy')}</span>}
          </>
        }
      />
      <div className="scroll">
        <div className="tabpanel">{children}</div>
      </div>
    </main>
  )
}

function Fact({ l, v, mono, title, cls }: { l: string; v: string; mono?: boolean; title?: string; cls?: string }) {
  return (
    <div className={'fact' + (cls ? ' ' + cls : '')} title={title}>
      <span className="lbl">{l}</span>
      <span className={'v' + (mono ? ' mono' : '')}>{v}</span>
    </div>
  )
}
