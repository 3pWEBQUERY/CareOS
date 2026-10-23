import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/context'
import { isExternalPhysician } from '@/lib/permissions'
import { myShiftNow } from '@/lib/shift'
import { pickHomeView } from '@/lib/home-view'
import { AutoRefresh } from './_home/AutoRefresh'
import { CareHome } from './_home/CareHome'
import { LeadHome } from './_home/LeadHome'
import { QualityHome } from './_home/QualityHome'
import { OfficeHome } from './_home/OfficeHome'
import { PhysicianHome } from './_home/PhysicianHome'
import { TherapyHome } from './_home/TherapyHome'

export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.home') }
}

/**
 * Persönliche Startseite (PRD §7): aufgebaut nach Rolle, Arbeitsort, Dienst und Bewohnerzuordnung (§4.6).
 * Pflege im Dienst → Station; Leitung über mehrere Bereiche → Bereichsübersicht; QM → Qualität; HR/Admin → Verwaltung.
 * Wer mehrere Ansichten hat, wechselt oben rechts (?view=…).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string; scope?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  // Externe Ärztinnen und Ärzte arbeiten im Ärzteportal (PRD §60)
  if (isExternalPhysician(ctx.user)) redirect('/md')
  const { t, user, unit } = ctx
  const now = new Date()
  const h = now.getHours()
  const greet = t(h < 5 || h >= 22 ? 'home.night' : h < 11 ? 'home.morning' : h < 18 ? 'home.day' : 'home.evening', { name: user.firstName })

  const scopeOf = (id: string) => ({ unitId: id, locationId: ctx.units.find((u) => u.id === id)?.locationId })
  const mine = unit ? await myShiftNow(user.id, ctx.org.id, now) : null
  const { view, views } = pickHomeView({
    careHere: !!unit && ctx.canHere('resident.read') && (ctx.canHere('task.read') || ctx.canHere('handover.read')),
    onDutyHere: !!mine && mine.unitId === unit?.id,
    clinicalUnits: ctx.units.filter((u) => ctx.can('resident.read', scopeOf(u.id)) && ctx.can('task.read', scopeOf(u.id))).length,
    leadPerms: ctx.can('schedule.manage') || ctx.can('insights.view'),
    quality: ctx.can('quality.manage'),
    office: ctx.can('admin.users') || ctx.can('admin.org'),
    physician: ctx.can('resident.medication.edit') && ctx.can('resident.visit.conduct') && !ctx.can('task.complete'),
    therapy: ctx.can('therapy.document') && !ctx.can('resident.medication.administer'),
  }, sp.view)

  const props = { ctx, now, greet, view, views }
  return (
    <>
      <AutoRefresh />
      {view === 'care' ? <CareHome {...props} scopeParam={sp.scope} />
        : view === 'physician' ? <PhysicianHome {...props} />
        : view === 'therapy' ? <TherapyHome {...props} />
        : view === 'lead' ? <LeadHome {...props} />
        : view === 'quality' ? <QualityHome {...props} />
        : <OfficeHome {...props} />}
    </>
  )
}
