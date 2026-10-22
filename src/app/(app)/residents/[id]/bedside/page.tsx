import Link from 'next/link'
import { db } from '@/lib/db'
import { ensureTasksForDay, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { addDays, addMinutes, age, fmtDayMonth, fmtDbDate, hm, startOfDay } from '@/lib/time'
import { LIVE, mergeLimits, VITALS, type VitalKey } from '@/lib/vitals'
import { keyLabel, WOUND_KINDS } from '@/lib/care'
import { ResidentPhoto } from '@/components/residents/ResidentPhoto'
import { FocusSuggestions } from '@/components/forms/FocusSuggestions'
import { FormEntry } from '@/components/forms/FormEntry'
import { pageResident, residentName, residentTitle, taskCategory, userNames } from '../../_lib/resident'
import { focusFor } from '../../_lib/focus'
import { DayPlan, type DayTask } from '../day/DayPlan'
import { VitalForm } from '../vitals/VitalForm'
import { BedsideNote } from './BedsideNote'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'bedside')
}

/**
 * Am Bett (PRD §29, Tablet): eine Person fixiert, Identität mit Foto, Name und Geburtsdatum prüfen, dann die
 * häufigen Erfassungen mit grossen Flächen – jetzt fällige Massnahmen, Vitalwerte, Verlaufseintrag, Wunden.
 */
export default async function BedsidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const now = new Date()
  const who = `${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  if (can('task.read')) await ensureTasksForDay(r.unitId, now)
  const [tasks, limitRows, glucoseCount, wounds] = await Promise.all([
    can('task.read') ? db.task.findMany({ where: { residentId: r.id, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) }, source: { not: 'medication' } }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] }) : [],
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id, OR: [{ residentId: null }, { residentId: r.id }] } }),
    db.vitalSign.count({ where: { residentId: r.id, ...LIVE, glucose: { not: null } } }),
    db.wound.findMany({ where: { residentId: r.id, status: { not: 'closed' } }, include: { entries: { where: LIVE, orderBy: { at: 'desc' }, take: 1, select: { at: true, nextChange: true } } } }),
  ])
  // Jetzt relevant: offen und fällig bis in 2 Stunden (inkl. überfällige) sowie heute bereits erledigte der letzten Stunde
  const soon = addMinutes(now, 120)
  const relevant = tasks.filter((k) => (['planned', 'ready', 'in_progress', 'escalated'].includes(k.status) && k.dueAt <= soon) || (k.completedAt && k.completedAt >= addMinutes(now, -60)))
  const names = await userNames(ctx, relevant.map((k) => k.completedById))
  const rows: DayTask[] = relevant.map((k) => {
    const cat = taskCategory(t, k.category)
    return {
      id: k.id, time: hm(k.dueAt), due: k.dueAt.toISOString(), title: taskTitle(t, k), description: k.description, category: cat.label, tone: cat.tone,
      min: k.durationMin, status: k.status, view: taskView(k, now), source: k.source, at: k.completedAt ? hm(k.completedAt) : null,
      by: k.completedById ? names.get(k.completedById)?.short ?? null : null, note: k.note,
    }
  })
  const limits = mergeLimits(limitRows, r.id)
  const showGlucose = glucoseCount > 0 || r.risks.some((x) => /diab/i.test(x))
  const keys: VitalKey[] = ['sys', 'dia', 'pulse', 'temp', 'spo2', ...(showGlucose ? (['glucose'] as VitalKey[]) : []), 'respRate', 'pain']
  const focus = can('resident.chart.write') ? await focusFor(ctx, r) : null
  const reaText = t(r.rea === 'yes' ? 'residents.banner.reaYes' : r.rea === 'no' ? 'residents.banner.reaNo' : 'residents.banner.reaUnknown')

  return (
    <div className="bedside">
      <section className="card bedside-id" aria-labelledby="bs-id">
        <ResidentPhoto residentId={r.id} photoId={r.photoFileId} name={residentName(r)} size="xl" />
        <div className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
          <span className="lbl">{t('chart.bedside.identity')}</span>
          <h2 id="bs-id" className="bedside-name">{r.lastName} {r.firstName}</h2>
          <span className="mono">{t('chart.bedside.born', { date: fmtDbDate(r.birthDate, locale), age: age(r.birthDate) })} · {t('residents.banner.room')} {r.room?.number ?? '–'}</span>
          <div className="row" style={{ gap: 6 }}>
            {r.allergies.length ? r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>) : <span className="flag">{t('residents.banner.noAllergies')}</span>}
            <span className={'flag ' + (r.rea === 'yes' ? 'rea-yes' : r.rea === 'no' ? 'rea-no' : '')}>{reaText}</span>
          </div>
        </div>
      </section>

      {focus && focus.suggestions.length > 0 && (
        <div className="bedside-wide">
          <FocusSuggestions items={focus.suggestions} notesHref={`/residents/${r.id}/notes`} />
          <FormEntry residentId={r.id} who={who} forms={focus.forms} hideButton />
        </div>
      )}

      {can('task.read') && (
        <section className="bedside-col" aria-labelledby="bs-now">
          <div className="sec-head"><h2 className="sec" id="bs-now">{t('chart.bedside.now')}</h2><span className="small muted">{t('chart.bedside.nowHint')}</span></div>
          {rows.length ? (
            <DayPlan residentId={r.id} who={who} tasks={rows} dateLabel={fmtDayMonth(now, locale)} canComplete={can('task.complete')} canManage={false} now={now.toISOString()} me={`${ctx.user.firstName.charAt(0)}. ${ctx.user.lastName}`} categories={[]} />
          ) : <p className="empty">{t('chart.bedside.nothingNow')}</p>}
          {wounds.length > 0 && (
            <>
              <div className="sec-head"><h2 className="sec">{t('residents.tabs.wounds')}</h2></div>
              <ul className="list card">
                {wounds.map((w) => {
                  const next = w.entries[0]?.nextChange
                  const over = next != null && next < now
                  return (
                    <li key={w.id}><div className="li">
                      <div className="grow">
                        <div>{w.bodySite} · {keyLabel(t, 'kinds', WOUND_KINDS, w.kind)}</div>
                        <div className={'small ' + (over ? 'crit-text' : 'muted')}>{next ? `${over ? '▲ ' : ''}${t('care.wounds.nextNow')} ${fmtDayMonth(next, locale)} ${hm(next)}` : t('care.wounds.noNext')}</div>
                      </div>
                      {can('resident.wounds.write') && <Link className="btn lg" href={`/residents/${r.id}/wounds/${w.id}#we-h`}>{t('chart.bedside.woundAssess')}</Link>}
                    </div></li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="bedside-col" aria-labelledby="bs-doc">
        {can('resident.vitals.write') && (
          <>
            <div className="sec-head"><h2 className="sec" id="bs-doc">{t('chart.vitals.new')}</h2></div>
            <VitalForm residentId={r.id} who={residentName(r)} fields={keys.map((k) => ({ key: k, label: t('common.vitals.' + k), unit: VITALS[k].unit, min: VITALS[k].min, max: VITALS[k].max, dec: VITALS[k].dec, lo: limits[k].lo, hi: limits[k].hi }))} />
          </>
        )}
        {can('resident.chart.write') && (
          <>
            <div className="sec-head"><h2 className="sec">{t('chart.bedside.note')}</h2></div>
            <div className="card card-body"><BedsideNote residentId={r.id} who={who} /></div>
          </>
        )}
      </section>
    </div>
  )
}
