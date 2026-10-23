import Link from 'next/link'
import { db } from '@/lib/db'
import { getMdCtx, mdResidentInScope } from '@/lib/md/context'
import { headers } from 'next/headers'
import { audit } from '@/lib/audit'
import { addDays, age, dateKey, fmtDate, fmtDayMonth, fmtNum, hm, startOfDay } from '@/lib/time'
import { flag, LIVE, VITALS, VITAL_KEYS, type VitalKey } from '@/lib/vitals'
import { limitsFor, openQuestions, visitsToday } from '@/lib/visit-data'
import { orderDtosFor } from '@/lib/medication-orders'
import { DEFAULT_SLOTS, slotsOf } from '@/lib/medication'
import { checkInteractions, providerFor } from '@/lib/integrations/drug-interactions'
import { Empty } from '@/components/ui/Empty'
import { VisitCapture } from '@/components/visit/VisitCapture'
import { Orders } from '@/components/meds/Orders'
import { mdCompleteVisit, mdConfirmOrder, mdPreviewInteractions, mdSaveOrder, mdStopOrder } from '../../actions'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const md = await getMdCtx()
  const r = await mdResidentInScope(md, (await params).id)
  return { title: r ? `${r.lastName} ${r.firstName} – ${md.t('md.person.label')}` : md.t('md.portal') }
}

const SHOWN: VitalKey[] = ['sys', 'pulse', 'temp', 'spo2', 'glucose', 'respRate', 'pain', 'weight']

/**
 * Kurzakte im Ärzteportal (PRD §60): Stammdaten, Allergien, REA, Medikation (verordnen, ändern, absetzen, visieren),
 * Vitalwerte 14 Tage, Labor, ärztliche Einträge, Wunden; rechts die asynchrone Visite. Nur lesend ausser Visite/Medikation.
 */
export default async function MdPerson({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const md = await getMdCtx()
  const { t, locale } = md
  const r = await mdResidentInScope(md, id)
  if (!r) {
    return (
      <main className="panel main" style={{ flex: 1 }}>
        <div className="view-head"><div><span className="lbl">{t('md.portal')}</span><h1>{t('md.person.label')}</h1></div></div>
        <div className="scroll"><div className="tabpanel"><Empty title={t('md.person.notFound')} action={<Link className="btn" href="/md">{t('md.person.back')}</Link>} /></div></div>
      </main>
    )
  }
  const now = new Date()
  const canMeds = md.can('resident.medication.read')
  const [vitals, limits, notes, wounds, labs, contacts, qs, done, appts, orders, integration] = await Promise.all([
    db.vitalSign.findMany({ where: { residentId: r.id, at: { gte: addDays(now, -14) }, ...LIVE }, orderBy: { at: 'desc' }, take: 40 }),
    limitsFor(md, r.id),
    db.observation.findMany({ where: { residentId: r.id, at: { gte: addDays(now, -30) }, correctedBy: { none: {} }, OR: [{ category: 'physician' }, { important: true }, { category: 'incident' }] }, orderBy: { at: 'desc' }, take: 12 }),
    db.wound.findMany({ where: { residentId: r.id, status: { not: 'closed' } }, orderBy: { startedAt: 'desc' } }),
    db.labResult.findMany({ where: { orgId: md.org.id, residentId: r.id }, orderBy: { collectedAt: 'desc' }, take: 20 }),
    db.contact.findMany({ where: { residentId: r.id, isLegalRep: true }, select: { id: true, name: true, relation: true, phone: true } }),
    openQuestions(md, [r.id], now),
    visitsToday(md, r.id, now),
    db.appointment.findMany({ where: { residentId: r.id, kind: 'physician', done: false, at: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } }, orderBy: { at: 'asc' } }),
    canMeds ? orderDtosFor(md, r.id, { canConfirm: md.can('resident.medication.edit') }, now) : Promise.resolve([]),
    db.integration.findFirst({ where: { orgId: md.org.id, kind: 'drug_interactions', active: true } }),
  ])
  // Lesezugriff protokollieren (PRD §35, Ärzteportal)
  if (!(await headers()).get('next-router-prefetch')) await audit(md, { action: 'md.resident.view', entityType: 'Resident', entityId: r.id, context: { residentId: r.id } })

  const name = `${r.lastName} ${r.firstName}`
  const who = `${name} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  const reaCls = r.rea === 'yes' ? 'rea-yes' : r.rea === 'no' ? 'rea-no' : ''
  const reaText = t(r.rea === 'yes' ? 'residents.banner.reaYes' : r.rea === 'no' ? 'residents.banner.reaNo' : 'residents.banner.reaUnknown')
  const val = (k: VitalKey, v: number) => `${fmtNum(v, VITALS[k].dec, locale)}`
  const ia = await checkInteractions(providerFor(integration), orders.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name, atc: o.atc, gtin: o.gtin })), locale)
  const iaNote = ia.status === 'checked' ? t('meds.interactions.orderNoteChecked', { name: ia.source }) : t(ia.reason === 'error' ? 'meds.interactions.orderNoteError' : 'meds.interactions.orderNote')
  const me = `${md.user.firstName} ${md.user.lastName}`

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl"><Link className="linkbtn" href="/md">{t('md.person.back')}</Link> · {t('md.person.label')} · {r.unit.name}</span>
          <h1>{name}</h1>
          <p className="sub">{t('md.person.audit')}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="md-person">
          <div className="stack md-person-main">
            <section className="visit-banner" aria-labelledby="mp-h">
              <div className="visit-banner-who">
                <span className="room mono" aria-label={`${t('residents.banner.room')} ${r.room?.number ?? '–'}`}>{r.room?.number ?? '–'}</span>
                <div className="grow">
                  <h2 id="mp-h">{r.lastName} <span>{r.firstName}</span></h2>
                  <p className="small muted" style={{ margin: 0 }}>
                    <span className="mono">{age(r.birthDate)} {t('common.years')}</span> · {t('md.person.birth')} <span className="mono">{fmtDate(r.birthDate, locale)}</span>
                    {r.careLevel != null && <> · {t('md.person.careLevel')} <span className="mono">{r.careLevel}</span></>}
                  </p>
                </div>
              </div>
              <div className="flags">
                {r.status === 'absent' && <span className="flag info">{t('residents.banner.absent')}</span>}
                {r.allergies.length ? r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>) : <span className="flag">{t('residents.banner.noAllergies')}</span>}
                {r.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
                <span className={'flag ' + reaCls}>{reaText}</span>
              </div>
              {r.importantNotes && <p className="small rec-note" style={{ margin: 0 }}><span className="lbl">{t('residents.rec.important')}</span> {r.importantNotes}</p>}
              <p className="small muted" style={{ margin: 0 }}>
                <span className="lbl">{t('md.person.legalRep')}</span>{' '}
                {contacts.length ? contacts.map((c) => [c.name, c.relation, c.phone].filter(Boolean).join(', ')).join(' · ') : t('md.person.noLegalRep')}
              </p>
            </section>

            {canMeds && (
              <div className="stack-sm md-orders">
                <Orders orders={orders} canEdit={md.can('resident.medication.edit')} actions={{ save: mdSaveOrder, stop: mdStopOrder, confirm: mdConfirmOrder, preview: mdPreviewInteractions }}
                  resident={{ id: r.id, name, room: r.room?.number ?? null, allergies: r.allergies, photoId: r.photoFileId }}
                  defaultSlots={[...new Set([...DEFAULT_SLOTS, ...slotsOf(orders.filter((o) => o.active))])].sort()} defaultPrescriber={me} todayKey={dateKey(startOfDay(now))} interactionNote={iaNote} />
              </div>
            )}

            <section className="card" aria-labelledby="mp-vit">
              <div className="card-head"><h2 id="mp-vit">{t('md.person.vitals')}</h2></div>
              {vitals.length ? (
                <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="stable">
                    <thead><tr><th>{t('md.person.measuredAt')}</th>{SHOWN.map((k) => <th key={k} className="right">{t('common.vitals.' + k)} <span className="muted small">{VITALS[k].unit}</span></th>)}</tr></thead>
                    <tbody>
                      {vitals.map((v) => (
                        <tr key={v.id}>
                          <td className="num nowrap">{fmtDayMonth(v.at, locale)} {hm(v.at)}</td>
                          {SHOWN.map((k) => {
                            const x = (k === 'sys' ? v.sys : (v as Record<string, unknown>)[k]) as number | null
                            if (x == null) return <td key={k} className="right muted">–</td>
                            const f = k === 'weight' ? '' : flag(k, x, limits)
                            const f2 = k === 'sys' && v.dia != null ? flag('dia', v.dia, limits) : ''
                            const shown = k === 'sys' && v.dia != null ? `${val('sys', x)}/${val('dia', v.dia)}` : val(k, x)
                            const mark = f === 'hi' || f2 === 'hi' ? ' ▲' : f === 'lo' || f2 === 'lo' ? ' ▼' : ''
                            return <td key={k} className={'right num nowrap' + (mark ? ' crit-text' : '')}>{shown}{mark && <span aria-label={t(f === 'hi' || f2 === 'hi' ? 'visit.person.hi' : 'visit.person.lo')}>{mark}</span>}</td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="card-body small muted">{t('md.person.vitalsNone')}</div>}
            </section>

            <section className="card" aria-labelledby="mp-notes">
              <div className="card-head"><h2 id="mp-notes">{t('md.person.notes')}</h2></div>
              {notes.length ? (
                <ul className="list">
                  {notes.map((o) => (
                    <li key={o.id} className="li visit-note">
                      <time className="small muted mono nowrap">{fmtDayMonth(o.at, locale)} {hm(o.at)}</time>
                      <span className={'tag ' + (o.category === 'incident' ? 'crit' : o.important ? 'warn' : '')} style={{ flex: 'none' }}>{t('chart.cat.' + o.category)}</span>
                      <span className="grow small fg2 visit-note-text">{o.text}</span>
                    </li>
                  ))}
                </ul>
              ) : <div className="card-body small muted">{t('md.person.notesNone')}</div>}
            </section>

            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
              <section className="card" aria-labelledby="mp-wounds">
                <div className="card-head"><h2 id="mp-wounds">{t('md.person.wounds')}</h2></div>
                {wounds.length ? (
                  <ul className="list">
                    {wounds.map((w) => (
                      <li key={w.id} className="li">
                        <span className="grow">{w.kind} · {w.bodySite}{w.classification && <span className="muted"> · {w.classification}</span>}<span className="small muted" style={{ display: 'block' }}>{t('md.person.woundSince', { date: fmtDate(w.startedAt, locale) })}</span></span>
                        <span className="tag">{t('care.wounds.status.' + w.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('md.person.woundsNone')}</div>}
              </section>
              <section className="card" aria-labelledby="mp-labs">
                <div className="card-head"><h2 id="mp-labs">{t('md.person.labs')}</h2></div>
                {labs.length ? (
                  <ul className="list">
                    {labs.map((x) => (
                      <li key={x.id} className="li">
                        <span className="grow">{x.name}<span className="small muted" style={{ display: 'block' }}>{fmtDate(x.collectedAt, locale)}{x.refRange ? ` · ${x.refRange}` : ''}</span></span>
                        <span className={'mono nowrap' + (x.flag && x.flag !== 'normal' ? ' crit-text' : '')}>{x.value}{x.unit ? ' ' + x.unit : ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('md.person.labsNone')}</div>}
              </section>
            </div>
          </div>
          <div id="visit" className="md-person-side">
            <VisitCapture
              key={r.id + ':' + done.length}
              residentId={r.id}
              name={name}
              who={who}
              physician={me}
              physicianFixed
              appointmentId={appts[0]?.id ?? null}
              questions={qs.map((q) => q.dto)}
              readOnly={!md.can('resident.visit.conduct')}
              documented={done.length > 0}
              next={null}
              todayKey={dateKey(now)}
              action={mdCompleteVisit}
            />
          </div>
        </div>
      </div>
    </main>
  )
}
