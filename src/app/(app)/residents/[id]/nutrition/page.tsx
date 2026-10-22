import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { addDays, fmtDate, fmtDayMonth, fmtNum, hm, startOfDay, weekdayShort } from '@/lib/time'
import { LOCALES, type Tree } from '@/i18n/core'
import careMessages from '@/i18n/messages/care'
import { MEALS, portionLabel, type Meal } from '@/lib/care'
import { LIVE } from '@/lib/vitals'
import { BarChart } from '@/components/ui/BarChart'
import { LineChart } from '@/components/ui/LineChart'
import { DrinkQuick, FluidEntry, MealPortion, ProfileButton } from './NutritionClient'
import { fluidBalance, isFluidOut, signedMl, FLUID_IN, FLUID_OUT } from '@/lib/fluid-balance'
import { residentTitle } from '../../_lib/resident'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'nutrition')
}

/** Mahlzeit eines Eintrags erkennen – Einträge tragen den Namen der Mahlzeit in der Sprache der erfassenden Person. */
const MEAL_NAMES: [Meal, string][] = LOCALES.flatMap((l) => {
  const names = ((careMessages[l].nutrition as Tree).mealNames as Tree)
  return MEALS.map((m) => [m, String(names[m]).toLowerCase()] as [Meal, string])
})
const mealOf = (item: string | null): Meal | null => {
  const v = (item ?? '').toLowerCase()
  return MEAL_NAMES.find(([, n]) => v.startsWith(n))?.[0] ?? null
}

export default async function NutritionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  const r = await residentInScope(ctx, id)
  if (!r) notFound()
  const canWrite = ctx.can('resident.nutrition.write', { unitId: r.unitId, locationId: r.unit.locationId })
  const now = new Date()
  const today = startOfDay(now)
  const [profile, intake, weights, mna] = await Promise.all([
    db.nutritionProfile.findUnique({ where: { residentId: r.id } }),
    db.intakeLog.findMany({ where: { residentId: r.id, at: { gte: addDays(today, -6) } }, orderBy: { at: 'desc' } }),
    db.vitalSign.findMany({ where: { residentId: r.id, ...LIVE, weight: { not: null }, at: { gte: addDays(today, -90) } }, orderBy: { at: 'asc' }, select: { at: true, weight: true } }),
    db.assessment.findFirst({ where: { residentId: r.id, key: 'mna', ...LIVE }, orderBy: { at: 'desc' } }),
  ])
  const authors = new Map(
    (await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(intake.map((i) => i.authorId))] } }, select: { id: true, firstName: true, lastName: true } }))
      .map((u) => [u.id, `${u.firstName.charAt(0)}. ${u.lastName}`]),
  )
  const target = profile?.fluidTargetMl ?? null
  const contextLabel = `${r.lastName} ${r.firstName}${r.room ? ' · ' + t('care.roomShort', { room: r.room.number }) : ''}`

  // Trinkmenge je Tag (7 Tage inkl. heute)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const drinks = intake.filter((i) => i.kind === 'drink' && i.amountMl)
  const ofDay = (d: Date) => drinks.filter((i) => i.at >= d && i.at < addDays(d, 1))
  // Tage ohne Eintrag gelten als nicht dokumentiert (kein Balken), nicht als 0 ml.
  const daySums = days.map((d) => ({ d, n: ofDay(d).length, v: ofDay(d).reduce((s, i) => s + (i.amountMl ?? 0), 0) }))
  const todaySum = daySums[6].v
  const pct = target ? Math.round((todaySum / target) * 100) : null
  const todayDrinks = drinks.filter((i) => i.at >= today)
  const lastItem = todayDrinks[0]?.item ?? ''

  // Flüssigkeitsbilanz (PRD §14): heute und die zwei Vortage; Bilanz nur mit erfasster Ausfuhr
  const balance = fluidBalance(intake, [days[6], days[5], days[4]])
  const fluidToday = intake.filter((i) => i.at >= today && (isFluidOut(i.kind) || (FLUID_IN as readonly string[]).includes(i.kind)))
  const showBalance = canWrite || balance.some((b) => b.outEntries > 0 || b.in.in_infusion || b.in.in_tube)
  const ml = (v: number) => fmtNum(v, 0, locale)

  // Mahlzeiten heute: letzter Eintrag je Mahlzeit gilt
  const meals = intake.filter((i) => i.kind === 'meal' && i.at >= today)
  const mealNow = new Map<Meal, (typeof meals)[number]>()
  const otherMeals: typeof meals = []
  for (const m of meals) {
    const k = mealOf(m.item)
    if (k && !mealNow.has(k)) mealNow.set(k, m)
    else if (!k) otherMeals.push(m)
  }

  // Gewicht
  const latestW = weights[weights.length - 1] ?? null
  const changeOver = (n: number) => {
    if (!latestW) return null
    const base = weights.find((w) => w.at >= addDays(now, -n) && w.at < latestW.at)
    if (!base?.weight || !latestW.weight) return null
    return { from: base.weight, to: latestW.weight, pct: ((latestW.weight - base.weight) / base.weight) * 100 }
  }
  const c30 = changeOver(30)
  const c90 = changeOver(90)

  // Trendwarnungen (PRD §16)
  const d1 = daySums[5]
  const d2 = daySums[4]
  const fluidWarn = Boolean(target && d1.n > 0 && d2.n > 0 && d1.v < target * 0.75 && d2.v < target * 0.75)
  const weightWarn = c30 != null && c30.pct < -5
  const pctFmt = (v: number) => (v > 0 ? '+' : '') + fmtNum(v, 1, locale)
  const arrow = (v: number) => (v > 0.05 ? '▲ ' : v < -0.05 ? '▼ ' : '')

  return (
    <>
      <div className="sec-head">
        <div>
          <h2 className="sec">{t('residents.tabs.nutrition')}</h2>
          <span className="small muted">{profile?.dietForm ?? r.diet ?? t('care.nutrition.noProfile')}{profile?.texture ? ' · ' + profile.texture : ''}</span>
        </div>
      </div>

      {fluidWarn && (
        <div className="alert warn" role="alert">
          <div className="grow">
            <strong>{t('care.nutrition.warnFluid')}</strong>
            <span className="fg">{t('care.nutrition.warnFluidText', { d1: fmtDayMonth(d2.d, locale), v1: d2.v, d2: fmtDayMonth(d1.d, locale), v2: d1.v, target: target ?? 0 })}</span>
          </div>
        </div>
      )}
      {weightWarn && c30 && (
        <div className="alert warn" role="alert">
          <div className="grow">
            <strong>{t('care.nutrition.warnWeight')}</strong>
            <span className="fg">{t('care.nutrition.warnWeightText', { from: fmtNum(c30.from, 1, locale), to: fmtNum(c30.to, 1, locale), pct: pctFmt(c30.pct) })}</span>
          </div>
          <Link className="btn sm" href={`/residents/${r.id}/assessments?k=mna`}>{t('care.nutrition.toAssessments')}</Link>
        </div>
      )}

      <div className="metrics metrics-2">
        <div className="metric">
          <span className="lbl">{t('care.nutrition.fluidToday')}</span>
          <span className={'val' + (pct != null && pct >= 100 ? ' ok' : '')}>{todaySum} <small>{target ? `/ ${target} ml` : 'ml'}</small></span>
          {target ? (
            <>
              <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={todaySum} aria-label={t('care.nutrition.fluidToday')}>
                <i className={pct! >= 100 ? 'ok' : pct! < 50 && now.getHours() >= 14 ? 'warn' : ''} style={{ width: Math.min(100, pct!) + '%' }} />
              </div>
              <span className="small muted">{t('care.nutrition.ofTarget', { pct: pct!, target })} · {todaySum >= target ? t('care.nutrition.reached') : t('care.nutrition.remaining', { ml: target - todaySum })}</span>
            </>
          ) : <span className="small muted">{t('care.nutrition.noTarget')}</span>}
        </div>
        <div className="metric">
          <span className="lbl">{t('care.nutrition.meals')}</span>
          <span className="val">{mealNow.size} <small>/ {MEALS.length}</small></span>
          <span className="small muted">{MEALS.filter((m) => mealNow.has(m)).map((m) => `${t('care.nutrition.mealNames.' + m)} ${portionLabel(mealNow.get(m)!.portion)}`).join(' · ') || t('care.nutrition.notRecorded')}</span>
        </div>
        <div className="metric">
          <span className="lbl">{t('care.nutrition.weightLatest')}</span>
          <span className="val">{latestW ? fmtNum(latestW.weight, 1, locale) : '–'} <small>kg</small></span>
          <span className="small muted">{latestW ? fmtDate(latestW.at, locale) : t('care.nutrition.noData')}</span>
        </div>
        <div className="metric">
          <span className="lbl">{t('care.nutrition.change30')}</span>
          <span className={'val' + (weightWarn ? ' crit' : '')}>{c30 ? arrow(c30.pct) + pctFmt(c30.pct) : '–'} <small>%</small></span>
          <span className="small muted">{t('care.nutrition.change90')}: {c90 ? arrow(c90.pct) + pctFmt(c90.pct) + ' %' : t('care.nutrition.noData')}</span>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="n-drink">
          <div className="card-head"><h3 id="n-drink">{t('care.nutrition.quickAdd')}</h3></div>
          <div className="card-body stack">
            {canWrite && <DrinkQuick residentId={r.id} defaultItem={lastItem} />}
            <div className="stack-sm">
              <span className="lbl">{t('care.nutrition.drinksToday')}</span>
              {todayDrinks.length ? (
                <div className="tablewrap">
                  <table className="stable">
                    <tbody>
                      {todayDrinks.map((i) => (
                        <tr key={i.id}>
                          <td className="num" style={{ width: 64 }}>{hm(i.at)}</td>
                          <td>{i.item ?? '–'}</td>
                          <td className="num right nowrap">{i.amountMl} ml</td>
                          <td className="small muted nowrap">{authors.get(i.authorId) ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="small muted" style={{ margin: 0 }}>{t('care.nutrition.noDrinks')}</p>}
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="n-meals">
          <div className="card-head"><h3 id="n-meals">{t('care.nutrition.meals')}</h3></div>
          <ul className="list">
            {MEALS.map((m) => {
              const e = mealNow.get(m)
              const label = t('care.nutrition.mealNames.' + m)
              return (
                <li key={m} className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 140 }}>
                    <div>{label}</div>
                    <div className="small muted">{e ? `${hm(e.at)} · ${authors.get(e.authorId) ?? ''}` : t('care.nutrition.notRecorded')}</div>
                  </div>
                  {canWrite ? <MealPortion residentId={r.id} meal={m} mealLabel={label} current={e?.portion ?? null} /> : <span className="mono">{portionLabel(e?.portion)}</span>}
                </li>
              )
            })}
          </ul>
          {otherMeals.length > 0 && (
            <div className="card-foot small">
              <span className="lbl">{t('care.nutrition.otherMeals')}</span>{' '}
              {otherMeals.map((m) => `${hm(m.at)} ${m.item ?? ''} ${portionLabel(m.portion)}`).join(' · ')}
            </div>
          )}
        </section>
      </div>

      {showBalance && (
        <section className="card" aria-labelledby="n-bal">
          <div className="card-head">
            <h3 id="n-bal">{t('care.fluid.title')}</h3>
            <span className="small muted">{t('care.fluid.subtitle')}</span>
          </div>
          <div className="card-body stack">
            {canWrite && <FluidEntry residentId={r.id} />}
            <div className="tablewrap">
              <table className="stable fluid-table">
                <caption className="sr-only">{t('care.fluid.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">{t('care.fluid.kind')}</span></th>
                    {balance.map((b, i) => <th key={i} scope="col" className="right">{i === 0 ? t('common.today') : i === 1 ? t('common.yesterday') : fmtDayMonth(b.day, locale)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(['drink', ...FLUID_IN] as const).map((k) => (
                    <tr key={k}><th scope="row" className="fluid-sub">{t('care.fluid.kinds.' + k)}</th>{balance.map((b, i) => <td key={i} className="num right">{b.in[k] ? ml(b.in[k]) : '–'}</td>)}</tr>
                  ))}
                  <tr className="fluid-sum"><th scope="row">{t('care.fluid.inTotal')}</th>{balance.map((b, i) => <td key={i} className="num right">{ml(b.inMl)} ml</td>)}</tr>
                  {FLUID_OUT.map((k) => (
                    <tr key={k}><th scope="row" className="fluid-sub">{t('care.fluid.kinds.' + k)}</th>{balance.map((b, i) => <td key={i} className="num right">{b.out[k] ? ml(b.out[k]) : '–'}</td>)}</tr>
                  ))}
                  <tr className="fluid-sum"><th scope="row">{t('care.fluid.outTotal')}</th>{balance.map((b, i) => <td key={i} className="num right">{b.outEntries ? ml(b.outMl) + ' ml' : <span className="muted small">{t('care.fluid.notRecorded')}</span>}</td>)}</tr>
                  <tr className="fluid-bal"><th scope="row">{t('care.fluid.balance')}</th>{balance.map((b, i) => <td key={i} className="num right">{b.balance == null ? '–' : signedMl(b.balance, ml) + ' ml'}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: 0 }}>{t('care.fluid.hint')}</p>
            {fluidToday.length > 0 && (
              <div className="stack-sm">
                <span className="lbl">{t('care.fluid.today')}</span>
                <div className="tablewrap">
                  <table className="stable">
                    <tbody>
                      {fluidToday.map((i) => (
                        <tr key={i.id}>
                          <td className="num" style={{ width: 64 }}>{hm(i.at)}</td>
                          <td>{t('care.fluid.kinds.' + i.kind)}{i.item ? <span className="muted"> · {i.item}</span> : null}</td>
                          <td className="num right nowrap">{isFluidOut(i.kind) ? '−' : '+'}{i.amountMl} ml</td>
                          <td className="small muted nowrap">{authors.get(i.authorId) ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="charts">
        <BarChart
          title={t('care.nutrition.week')}
          unit="ml"
          bars={daySums.map(({ d, v, n }, i) => ({
            label: i === 6 ? t('common.today') : weekdayShort(d, locale),
            title: n ? `${fmtDayMonth(d, locale)}: ${v} ml${target ? ` (${Math.round((v / target) * 100)} %)` : ''}` : `${fmtDayMonth(d, locale)}: ${t('care.nutrition.notRecorded')}`,
            v: n ? v : null,
            tone: i === 6 ? 'muted' : target && v < target * 0.75 ? 'crit' : '',
          }))}
          target={target}
          current={String(todaySum)}
          alarm={fluidWarn}
          legend={{ bar: t('care.nutrition.legendIntake'), crit: target ? t('care.nutrition.legendBelow') : undefined, muted: t('care.nutrition.legendToday'), target: t('care.nutrition.legendTarget') + (target ? ` ${target} ml` : '') }}
          ariaLabel={t('care.nutrition.weekAria') + ': ' + daySums.map((x) => `${fmtDayMonth(x.d, locale)} ${x.n ? x.v + ' ml' : t('care.nutrition.notRecorded')}`).join(', ')}
        />
        {weights.length ? (
          (() => {
            const base = weights[0].weight!
            return (
              <LineChart
                title={t('care.nutrition.weight')}
                unit="kg"
                dec={1}
                points={weights.slice(-14).map((w) => ({ label: fmtDayMonth(w.at, locale), title: `${fmtDate(w.at, locale)}: ${fmtNum(w.weight, 1, locale)} kg`, v: w.weight }))}
                lo={+(base * 0.95).toFixed(1)}
                hi={+(base * 1.05).toFixed(1)}
                current={fmtNum(latestW!.weight, 1, locale)}
                alarm={weightWarn}
                legend={{ band: t('care.nutrition.weightBand') }}
                ariaLabel={t('care.nutrition.weightAria')}
                formatValue={(v) => fmtNum(v, 1, locale)}
              />
            )
          })()
        ) : (
          <div className="chart"><div className="chart-head"><strong>{t('care.nutrition.weight')}</strong></div><p className="small muted">{t('care.nutrition.noWeight')}</p></div>
        )}
      </div>

      <section className="card" aria-labelledby="n-prof">
        <div className="card-head">
          <h3 id="n-prof">{t('care.nutrition.profile')}</h3>
          {canWrite && (
            <ProfileButton
              residentId={r.id} contextLabel={contextLabel}
              values={{
                dietForm: profile?.dietForm ?? r.diet ?? '', texture: profile?.texture ?? '', intolerances: profile?.intolerances.join(', ') ?? '',
                supplements: profile?.supplements ?? '', swallowing: profile?.swallowing ?? '', fluidTargetMl: profile?.fluidTargetMl ? String(profile.fluidTargetMl) : '', notes: profile?.notes ?? '',
              }}
            />
          )}
        </div>
        <div className="card-body">
          <dl className="kv">
            <dt>{t('care.nutrition.fields.dietForm')}</dt><dd>{profile?.dietForm ?? r.diet ?? '–'}</dd>
            <dt>{t('care.nutrition.fields.texture')}</dt><dd>{profile?.texture ?? '–'}</dd>
            <dt>{t('care.nutrition.fields.allergies')}</dt>
            <dd>{r.allergies.length ? <span className="chips">{r.allergies.map((a) => <span key={a} className="tag crit">{a}</span>)}</span> : '–'}</dd>
            <dt>{t('care.nutrition.fields.intolerances')}</dt>
            <dd>{profile?.intolerances.length ? <span className="chips">{profile.intolerances.map((a) => <span key={a} className="tag warn">{a}</span>)}</span> : '–'}</dd>
            <dt>{t('care.nutrition.fields.swallowing')}</dt><dd className={profile?.swallowing ? 'warn-text' : ''}>{profile?.swallowing ?? '–'}</dd>
            <dt>{t('care.nutrition.fields.supplements')}</dt><dd>{profile?.supplements ?? '–'}</dd>
            <dt>{t('care.nutrition.fields.fluidTarget')}</dt><dd className="mono">{target ? `${target} ml` : t('care.nutrition.noTarget')}</dd>
            {profile?.notes && <><dt>{t('care.nutrition.fields.notes')}</dt><dd className="ws-pre">{profile.notes}</dd></>}
            <dt>{t('care.nutrition.mna')}</dt>
            <dd>
              {mna ? <>{fmtDate(mna.at, locale)} · <span className="mono">{mna.score ?? '–'}</span> {mna.result && <span className="tag outline">{mna.result}</span>}</> : t('care.nutrition.mnaNone')}{' '}
              <Link className="linkbtn small" href={`/residents/${r.id}/assessments?k=mna`}>{t('care.nutrition.toAssessments')} →</Link>
            </dd>
          </dl>
        </div>
      </section>
    </>
  )
}
