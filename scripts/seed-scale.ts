/**
 * Last-/Skalierungsdaten (PRD §66): erweitert die Demo «Haus Lindenhof» auf eine grosse Einrichtung –
 * 3 Standorte, 12 Wohngruppen, ~400 Bewohnende, ~250 Mitarbeitende, 60 Tage Verlauf, Vitalwerte,
 * Medikationsabgaben, Aufgaben, Dienstplan, Übergaben, Benachrichtigungen und Audit-Protokoll.
 *
 * NUR auf einer eigenen Datenbank verwenden (Name muss «scale» enthalten):
 *   createdb careos_scale
 *   DATABASE_URL=postgresql://…/careos_scale npx prisma migrate deploy
 *   DATABASE_URL=postgresql://…/careos_scale npm run db:seed
 *   DATABASE_URL=postgresql://…/careos_scale npm run seed:scale
 * Alle Personen und Werte sind erfunden.
 */
import { PrismaClient, type Prisma } from '@prisma/client'

const url = process.env.DATABASE_URL ?? ''
if (!/scale/i.test(new URL(url || 'postgresql://x/x').pathname)) {
  console.error('Abbruch: DATABASE_URL muss auf eine eigene Skalierungs-Datenbank zeigen (Name enthält «scale»).')
  process.exit(1)
}
const db = new PrismaClient()

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const R = rng(1966)
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1))
let seq = 0
const id = (p: string) => `sc${p}${(++seq).toString(36).padStart(7, '0')}`

const DAYS = 60
const now = new Date()
const nowMin = now.getHours() * 60 + now.getMinutes()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const at = (day: Date, time: string) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(toMin(time) / 60), toMin(time) % 60)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
const dbDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
const plusMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)

async function bulk<T>(label: string, rows: T[], fn: (chunk: T[]) => Promise<unknown>, size = 5000) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size))
  console.log(`  ${label}: ${rows.length}`)
}

const FIRST_F = ['Anna', 'Berta', 'Clara', 'Doris', 'Elsa', 'Frieda', 'Gertrud', 'Hanna', 'Ida', 'Johanna', 'Klara', 'Lina', 'Margrit', 'Nelly', 'Olga', 'Paula', 'Rosa', 'Silvia', 'Trudi', 'Ursula', 'Verena', 'Vreni', 'Elisabeth', 'Heidi', 'Marlis']
const FIRST_M = ['Adolf', 'Bruno', 'Carl', 'Dieter', 'Ernst', 'Fritz', 'Gustav', 'Hans', 'Jakob', 'Karl', 'Leo', 'Max', 'Otto', 'Paul', 'Rudolf', 'Theo', 'Urs', 'Walter', 'Werner', 'Willi', 'Kurt', 'Peter', 'Alfred']
const LAST = ['Ammann', 'Bachmann', 'Baumann', 'Bieri', 'Bolliger', 'Brunner', 'Bühler', 'Egli', 'Frei', 'Gerber', 'Graf', 'Gut', 'Hofer', 'Huber', 'Kaufmann', 'Keller', 'Koch', 'Kunz', 'Lehmann', 'Lüthi', 'Marti', 'Meier', 'Meyer', 'Moser', 'Müller', 'Roth', 'Schmid', 'Schneider', 'Steiner', 'Studer', 'Suter', 'Vogel', 'Wenger', 'Widmer', 'Wyss', 'Zbinden', 'Zimmermann', 'Zürcher', 'Fischer', 'Weber']
const STAFF_FIRST = ['Lara', 'Noah', 'Mia', 'Luca', 'Elena', 'Jan', 'Sara', 'Nico', 'Laura', 'Tim', 'Lea', 'David', 'Nina', 'Simon', 'Julia', 'Fabian', 'Selina', 'Marco', 'Jana', 'Andrea', 'Kevin', 'Céline', 'Dario', 'Aylin', 'Mehmet', 'Fatima', 'Goran', 'Ana', 'Sandro', 'Chiara']
const ALLERGIES = ['Penicillin', 'Latex', 'Jod', 'Sulfonamide', 'Nüsse', 'Laktose', 'Pflaster']
const RISKS = ['Sturzrisiko', 'Diabetes Typ 2', 'Dekubitusrisiko', 'Schluckstörung', 'Demenz', 'Herzinsuffizienz', 'Palliativ', 'Mangelernährung']
const MEDS: [string, string, string][] = [
  ['Metformin 500 mg', 'Tbl.', 'Diabetes Typ 2'], ['Bisoprolol 5 mg', 'Tbl.', 'Hypertonie'], ['Torasemid 10 mg', 'Tbl.', 'Herzinsuffizienz'],
  ['Pantoprazol 40 mg', 'Tbl.', 'Magenschutz'], ['Paracetamol 1 g', 'Tbl.', 'Schmerzen'], ['Sertralin 50 mg', 'Tbl.', 'Depression'],
  ['Amlodipin 5 mg', 'Tbl.', 'Hypertonie'], ['Atorvastatin 20 mg', 'Tbl.', 'Hypercholesterinämie'], ['Levothyroxin 50 µg', 'Tbl.', 'Hypothyreose'],
  ['Donepezil 5 mg', 'Tbl.', 'Demenz'], ['Macrogol', 'Btl.', 'Obstipation'], ['Calcium/Vitamin D', 'Kautbl.', 'Osteoporose'],
]
const PRN: [string, string, string][] = [['Paracetamol 500 mg', '1 Tbl.', 'Schmerzen NRS ≥ 4'], ['Lorazepam 1 mg', '1 Tbl.', 'Unruhe'], ['Movicol', '1 Btl.', 'Obstipation > 3 Tage']]
const SLOTS = ['07:30', '12:00', '17:30', '21:00']
const BASE: [string, string, string, number, string][] = [
  ['06:45', 'Grundpflege Morgen, Ankleiden', 'Grundpflege', 25, 'hygiene'],
  ['08:00', 'Frühstück begleiten', 'Ernährung', 15, 'nutrition'],
  ['10:00', 'Mobilisation / Gehtraining', 'Mobilität', 15, 'mobility'],
  ['12:00', 'Mittagessen begleiten', 'Ernährung', 15, 'nutrition'],
  ['15:30', 'Trinkprotokoll, Getränke anbieten', 'Ernährung', 5, 'nutrition'],
  ['19:30', 'Abendtoilette', 'Grundpflege', 20, 'hygiene'],
  ['21:30', 'Kontrollgang', 'Überwachung', 5, 'safety'],
]
const NOTES: [string, string][] = [
  ['care', 'Grundpflege am Lavabo, Haut intakt, keine Rötungen.'], ['care', 'Nacht ruhig verlaufen, mehrmals schlafend angetroffen.'],
  ['observation', 'Wirkt heute müde, Appetit vermindert. Weiter beobachten.'], ['care', 'Mobilisation mit Rollator über den Gang, gut gegangen.'],
  ['observation', 'Trinkmenge bis Mittag knapp 600 ml, Getränke angeboten.'], ['relatives', 'Besuch der Tochter am Nachmittag, gute Stimmung.'],
  ['care', 'Mittagessen vollständig eingenommen.'], ['observation', 'Leichte Unruhe am Abend, mit Gespräch beruhigt.'],
  ['physician', 'Hausarzt informiert, Kontrolle in einer Woche.'], ['care', 'Dusche mit Unterstützung, Nägel geschnitten.'],
]
const AUDIT_ACTIONS: [string, string][] = [
  ['observation.create', 'Observation'], ['vital.create', 'VitalSign'], ['task.complete', 'Task'], ['medication.administer', 'MedicationAdministration'],
  ['resident.view', 'Resident'], ['auth.login', 'Session'], ['careplan.update', 'CarePlan'], ['handover.ack', 'Handover'],
]

async function main() {
  const org = await db.organization.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })
  if (await db.resident.count({ where: { id: { startsWith: 'sc' } } })) {
    console.log('Skalierungsdaten sind bereits vorhanden – nichts zu tun.')
    return
  }
  const t0 = Date.now()
  const roles = Object.fromEntries((await db.role.findMany({ where: { orgId: org.id } })).map((r) => [r.key, r.id]))
  const shiftTypes = await db.shiftType.findMany({ where: { orgId: org.id } })
  const st = Object.fromEntries(shiftTypes.map((s) => [s.code, s]))
  const anyUser = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: 'anna.muster@lindenhof.ch' } })
  const pw = anyUser.passwordHash

  // ── Standorte und Wohngruppen: 3 Standorte × 4 Wohngruppen ──
  const locs = await db.location.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } })
  if (locs.length < 3) locs.push(await db.location.create({ data: { id: id('l'), orgId: org.id, name: 'Haus Sonnenberg', address: 'Sonnenbergstrasse 40, 8032 Zürich' } }))
  const units = await db.unit.findMany({ where: { orgId: org.id }, orderBy: { createdAt: 'asc' } })
  for (const [li, loc] of locs.slice(0, 3).entries()) {
    const have = units.filter((u) => u.locationId === loc.id).length
    for (let k = have; k < 4; k++) {
      const n = li * 4 + k + 1
      units.push(await db.unit.create({ data: { id: id('u'), orgId: org.id, locationId: loc.id, name: `Wohngruppe ${loc.name.split(' ').pop()} ${k + 1}`, shortName: `WG ${n}` } }))
    }
  }
  console.log(`Standorte ${locs.length}, Wohngruppen ${units.length}`)

  // ── Zimmer: 34 je Wohngruppe ──
  const roomRows: Prisma.RoomCreateManyInput[] = []
  const existingRooms = await db.room.findMany({ where: { unitId: { in: units.map((u) => u.id) } } })
  const roomsByUnit = new Map<string, string[]>()
  for (const [ui, u] of units.entries()) {
    const taken = new Set(existingRooms.filter((r) => r.unitId === u.id).map((r) => r.number))
    const list: string[] = []
    for (let k = 1; list.length < 34 - taken.size && k < 99; k++) {
      const number = String((ui + 1) * 100 + k + 10)
      if (taken.has(number)) continue
      const rid = id('r')
      roomRows.push({ id: rid, unitId: u.id, number })
      list.push(rid)
    }
    roomsByUnit.set(u.id, list)
  }
  await bulk('Zimmer', roomRows, (c) => db.room.createMany({ data: c }))

  // ── Mitarbeitende: ~19 je Wohngruppe + Leitungen je Standort ──
  const userRows: Prisma.UserCreateManyInput[] = []
  const raRows: Prisma.RoleAssignmentCreateManyInput[] = []
  const staffByUnit = new Map<string, string[]>()
  const existingStaff = await db.user.count({ where: { orgId: org.id } })
  const TARGET_STAFF = 250
  const perUnit = Math.ceil((TARGET_STAFF - existingStaff - locs.length) / units.length)
  let emailN = 0
  for (const u of units) {
    const ids: string[] = []
    for (let k = 0; k < perUnit; k++) {
      const role = k < 8 ? 'nurse' : k < 15 ? 'care_assistant' : k < 17 ? 'specialist' : 'nurse'
      const first = pick(STAFF_FIRST), last = pick(LAST)
      const uid = id('p')
      userRows.push({ id: uid, orgId: org.id, email: `scale.${++emailN}@lindenhof.ch`, firstName: first, lastName: last, initials: (first[0] + last[0]).toUpperCase(), jobTitle: role === 'care_assistant' ? 'Pflegehelfer/in SRK' : 'Pflegefachperson HF', passwordHash: pw, primaryUnitId: u.id, locale: pick(['de', 'de', 'de', 'fr', 'it', 'en'] as const) })
      raRows.push({ id: id('a'), userId: uid, roleId: roles[role], unitId: u.id })
      ids.push(uid)
    }
    staffByUnit.set(u.id, ids)
  }
  for (const loc of locs) {
    const uid = id('p')
    userRows.push({ id: uid, orgId: org.id, email: `scale.lead.${loc.id}@lindenhof.ch`, firstName: pick(STAFF_FIRST), lastName: pick(LAST), initials: 'SL', jobTitle: 'Stationsleitung', passwordHash: pw, primaryUnitId: units.find((u) => u.locationId === loc.id)?.id })
    raRows.push({ id: id('a'), userId: uid, roleId: roles.ward_lead, locationId: loc.id })
  }
  await bulk('Mitarbeitende', userRows, (c) => db.user.createMany({ data: c }))
  await bulk('Rollenzuweisungen', raRows, (c) => db.roleAssignment.createMany({ data: c }))
  // bestehende Demo-Pflegepersonen der WG 2 zählen mit
  const wg2 = units.find((u) => u.shortName === 'WG 2')!
  const demoStaff = await db.user.findMany({ where: { orgId: org.id, primaryUnitId: wg2.id, id: { not: { startsWith: 'sc' } } }, select: { id: true } })
  staffByUnit.get(wg2.id)!.push(...demoStaff.map((u) => u.id))

  // ── Bewohnende: Wohngruppen auf ~33 auffüllen (gesamt ~400) ──
  type Res = { id: string; unitId: string; diabetic: boolean; meds: { id: string; dose: number[] }[]; ivs: { id: string; time: string; title: string; cat: string; dur: number }[] }
  const residents: Res[] = []
  const resRows: Prisma.ResidentCreateManyInput[] = []
  const planRows: Prisma.CarePlanCreateManyInput[] = []
  const areaRows: Prisma.CarePlanAreaCreateManyInput[] = []
  const ivRows: Prisma.InterventionCreateManyInput[] = []
  const medRows: Prisma.MedicationCreateManyInput[] = []
  const nutRows: Prisma.NutritionProfileCreateManyInput[] = []
  const contactRows: Prisma.ContactCreateManyInput[] = []
  const existingRes = await db.resident.groupBy({ by: ['unitId'], _count: true })
  for (const u of units) {
    const have = existingRes.find((g) => g.unitId === u.id)?._count ?? 0
    const rooms = roomsByUnit.get(u.id)!
    const staff = staffByUnit.get(u.id)!
    for (let k = have; k < 33 + (units.indexOf(u) % 3 === 0 ? 1 : 0); k++) {
      const sex = R() < 0.68 ? 'f' : 'm'
      const rid = id('b')
      const risks = RISKS.filter(() => R() < 0.22)
      const diabetic = risks.includes('Diabetes Typ 2')
      resRows.push({
        id: rid, orgId: org.id, unitId: u.id, roomId: rooms[k - have] ?? null, firstName: pick(sex === 'f' ? FIRST_F : FIRST_M), lastName: pick(LAST),
        birthDate: new Date(Date.UTC(int(1925, 1948), int(0, 11), int(1, 28))), sex, careLevel: int(2, 12), physician: `Dr. med. ${pick(LAST)}`,
        primaryNurseId: pick(staff), rea: R() < 0.4 ? 'no' : 'yes', allergies: ALLERGIES.filter(() => R() < 0.08), risks, diet: diabetic ? 'Diabetische Kost' : 'Vollkost',
        mobility: pick(['selbstständig', 'Rollator', 'Rollstuhl', 'Transfer mit Hilfe']), admittedAt: addDays(today, -int(70, 2500)),
      })
      contactRows.push({ id: id('c'), residentId: rid, name: `${pick(STAFF_FIRST)} ${pick(LAST)}`, relation: pick(['Tochter', 'Sohn', 'Ehepartner/in', 'Beistand']), phone: '079 000 00 00', isEmergency: true })
      nutRows.push({ residentId: rid, dietForm: diabetic ? 'Diabetische Kost' : 'Vollkost', texture: risks.includes('Schluckstörung') ? 'püriert' : 'normal', fluidTargetMl: 1500, intolerances: [] })
      const plan = id('cp')
      planRows.push({ id: plan, residentId: rid, status: 'active', createdById: pick(staff), approvedById: pick(staff), approvedAt: addDays(today, -40), createdAt: addDays(today, -45), nextEvaluation: addDays(today, int(3, 40)) })
      const areas: Record<string, string> = {}
      for (const domain of ['hygiene', 'nutrition', 'mobility', 'safety']) {
        areas[domain] = id('ar')
        areaRows.push({ id: areas[domain], carePlanId: plan, domain, situation: 'Teilweise selbstständig', goal: 'Selbstständigkeit erhalten', evaluateBy: addDays(today, int(7, 60)) })
      }
      const ivs: Res['ivs'] = []
      for (const [time, title, cat, dur, domain] of BASE) {
        if (R() < 0.12) continue
        const iid = id('i')
        ivRows.push({ id: iid, residentId: rid, areaId: areas[domain], title, category: cat, times: [time], durationMin: dur, createdAt: addDays(today, -DAYS - 5) })
        ivs.push({ id: iid, time, title, cat, dur })
      }
      const meds: Res['meds'] = []
      const chosen = [...MEDS].sort(() => R() - 0.5).slice(0, int(3, 6))
      for (const [name, form, ind] of chosen) {
        const dose = SLOTS.map((_, si) => (si === 0 || R() < 0.3 ? 1 : 0))
        const mid = id('m')
        medRows.push({ id: mid, residentId: rid, name, form, indication: ind, kind: 'regular', times: SLOTS, doses: dose.map(String), prescriber: 'Dr. med. Keller', createdById: pick(staff), startDate: addDays(today, -DAYS - 10), createdAt: addDays(today, -DAYS - 10), stock: int(10, 90), stockUnit: 'Stk.' })
        meds.push({ id: mid, dose })
      }
      const [pn, pd, pi] = pick(PRN)
      medRows.push({ id: id('m'), residentId: rid, name: pn, form: pd, indication: pi, kind: 'prn', prnDose: pd, prnMaxPerDay: 3, prnMinIntervalH: 4, times: [], doses: [], createdById: pick(staff), startDate: addDays(today, -DAYS), createdAt: addDays(today, -DAYS), stock: 10, stockUnit: 'Stk.' })
      residents.push({ id: rid, unitId: u.id, diabetic, meds, ivs })
    }
  }
  await bulk('Bewohnende', resRows, (c) => db.resident.createMany({ data: c }))
  await bulk('Kontakte', contactRows, (c) => db.contact.createMany({ data: c }))
  await bulk('Ernährungsprofile', nutRows, (c) => db.nutritionProfile.createMany({ data: c }))
  await bulk('Pflegepläne', planRows, (c) => db.carePlan.createMany({ data: c }))
  await bulk('Pflegebereiche', areaRows, (c) => db.carePlanArea.createMany({ data: c }))
  await bulk('Interventionen', ivRows, (c) => db.intervention.createMany({ data: c }))
  await bulk('Medikamente', medRows, (c) => db.medication.createMany({ data: c }))

  // ── 60 Tage Verlauf: Vitalwerte, Verlaufseinträge, Abgaben, Aufgaben ──
  const vitals: Prisma.VitalSignCreateManyInput[] = []
  const obs: Prisma.ObservationCreateManyInput[] = []
  const mar: Prisma.MedicationAdministrationCreateManyInput[] = []
  const tasks: Prisma.TaskCreateManyInput[] = []
  for (const r of residents) {
    const staff = staffByUnit.get(r.unitId)!
    const base = { sys: int(115, 150), dia: int(65, 88), pulse: int(60, 88), temp: 36.4 + R() * 0.5, spo2: int(93, 98), weight: 50 + R() * 35, glucose: 6 + R() * 3 }
    const j = (b: number, s: number) => b + (R() - 0.5) * 2 * s
    for (let d = DAYS; d >= 0; d--) {
      const day = addDays(today, -d)
      const past = (time: string) => d > 0 || toMin(time) < nowMin - 30
      // Vitalwerte morgens, jeden dritten Tag zusätzlich abends; vereinzelt auffällig
      for (const time of d % 3 === 0 ? ['08:00', '18:30'] : ['08:00']) {
        if (!past(time)) continue
        const odd = R() < 0.06
        vitals.push({
          id: id('v'), residentId: r.id, at: plusMin(at(day, time), int(0, 40)), recordedById: pick(staff),
          sys: Math.round(j(base.sys, 9)) + (odd ? 35 : 0), dia: Math.round(j(base.dia, 6)), pulse: Math.round(j(base.pulse, 6)), temp: +(j(base.temp, 0.25) + (odd && R() < 0.5 ? 1.4 : 0)).toFixed(1),
          spo2: Math.min(100, Math.round(j(base.spo2, 1.5)) - (odd && R() < 0.4 ? 6 : 0)), glucose: r.diabetic ? +j(base.glucose, 1.6).toFixed(1) : null,
          weight: d % 7 === 0 ? +(base.weight + (R() - 0.5)).toFixed(1) : null, pain: R() < 0.3 ? int(0, 6) : null,
        })
      }
      // Verlauf: 2–4 Einträge je Tag
      for (let k = 0, n = int(2, 4); k < n; k++) {
        const time = ['06:30', '10:15', '14:00', '19:45'][k]
        if (!past(time)) continue
        const [cat, text] = pick(NOTES)
        obs.push({ id: id('o'), residentId: r.id, at: plusMin(at(day, time), int(0, 50)), category: cat as never, text, authorId: pick(staff), important: R() < 0.02, createdAt: plusMin(at(day, time), int(0, 60)) })
      }
      // Medikationsabgaben
      for (const m of r.meds) {
        for (const [si, time] of SLOTS.entries()) {
          if (!m.dose[si] || !past(time)) continue
          const refused = R() < 0.015
          mar.push({ id: id('x'), medicationId: m.id, residentId: r.id, scheduledFor: at(day, time), status: refused ? 'refused' : 'given', dose: '1', at: plusMin(at(day, time), int(0, 25)), byId: pick(staff) })
        }
      }
      // Aufgaben aus Pflegeplanung und Medikamenten-Zeitpunkten (heute: offen ab jetzt)
      for (const iv of r.ivs) {
        const done = past(iv.time) && R() > 0.01
        tasks.push({ id: id('t'), orgId: org.id, unitId: r.unitId, residentId: r.id, title: iv.title, category: iv.cat, dueAt: at(day, iv.time), durationMin: iv.dur, source: 'careplan', sourceId: iv.id, status: done ? 'done' : past(iv.time) ? 'skipped' : 'planned', completedById: done ? pick(staff) : null, completedAt: done ? plusMin(at(day, iv.time), int(2, 30)) : null })
      }
      for (const [si, time] of SLOTS.entries()) {
        if (!r.meds.some((m) => m.dose[si])) continue
        const done = past(time)
        tasks.push({ id: id('t'), orgId: org.id, unitId: r.unitId, residentId: r.id, title: 'medication.slot', category: 'Medikation', dueAt: at(day, time), durationMin: 5, source: 'medication', sourceId: `${r.id}:${time}`, status: done ? 'done' : 'planned', completedById: done ? pick(staff) : null, completedAt: done ? at(day, time) : null })
      }
    }
  }
  await bulk('Vitalwerte', vitals, (c) => db.vitalSign.createMany({ data: c }))
  await bulk('Verlaufseinträge', obs, (c) => db.observation.createMany({ data: c }))
  await bulk('Medikationsabgaben', mar, (c) => db.medicationAdministration.createMany({ data: c }))
  await bulk('Aufgaben', tasks, (c) => db.task.createMany({ data: c, skipDuplicates: true }))

  // ── Dienstplan: 60 Tage zurück, 35 Tage voraus ──
  const shifts: Prisma.ShiftCreateManyInput[] = []
  const codes = ['F', 'F', 'S', 'S', 'N'].filter((c) => st[c])
  for (const u of units) {
    for (const uid of staffByUnit.get(u.id)!.filter((x) => x.startsWith('sc'))) {
      for (let d = -DAYS; d <= 35; d++) {
        if (R() < 0.3) continue
        shifts.push({ id: id('s'), unitId: u.id, userId: uid, shiftTypeId: st[pick(codes)].id, date: dbDate(addDays(today, d)) })
      }
    }
    for (let d = 1; d <= 35; d += 4) shifts.push({ id: id('s'), unitId: u.id, shiftTypeId: st[pick(codes)].id, date: dbDate(addDays(today, d)), status: 'open' })
  }
  await bulk('Dienste', shifts, (c) => db.shift.createMany({ data: c }))

  // ── Übergaben mit Übernahmen ──
  const hos: Prisma.HandoverCreateManyInput[] = []
  const acks: Prisma.AcknowledgementCreateManyInput[] = []
  for (const u of units) {
    const staff = staffByUnit.get(u.id)!
    const resIds = residents.filter((r) => r.unitId === u.id).map((r) => r.id)
    for (let d = DAYS; d >= 1; d--) {
      for (const s of shiftTypes) {
        const hid = id('h')
        hos.push({ id: hid, unitId: u.id, shiftCode: s.code, date: dbDate(addDays(today, -d)), authorId: pick(staff), submittedAt: at(addDays(today, -d), s.end), note: 'Schicht ruhig verlaufen.' })
        const by = pick(staff)
        acks.push({ id: id('k'), userId: by, subjectType: 'handover', subjectId: hid, version: '', at: at(addDays(today, -d), s.end) })
        for (const rid of resIds.slice(0, 6)) acks.push({ id: id('k'), userId: by, subjectType: 'handover', subjectId: hid, version: rid, at: at(addDays(today, -d), s.end) })
      }
    }
  }
  await bulk('Übergaben', hos, (c) => db.handover.createMany({ data: c, skipDuplicates: true }))
  await bulk('Übernahmen', acks, (c) => db.acknowledgement.createMany({ data: c, skipDuplicates: true }))

  // ── Benachrichtigungen ──
  const notes: Prisma.NotificationCreateManyInput[] = []
  for (const u of userRows) {
    for (let k = 0; k < 40; k++) {
      const created = addDays(now, -int(0, DAYS))
      notes.push({ id: id('y'), userId: u.id as string, priority: pick(['action', 'info', 'info', 'social'] as const), kind: pick(['task', 'schedule', 'team', 'learn']), title: 'Neue Aufgabe zugewiesen', href: '/tasks', readAt: R() < 0.85 ? created : null, createdAt: created })
    }
  }
  await bulk('Benachrichtigungen', notes, (c) => db.notification.createMany({ data: c }))

  // ── Audit-Protokoll: ~200 000 Einträge über 60 Tage ──
  const allStaff = userRows.map((u) => u.id as string)
  const audits: Prisma.AuditLogCreateManyInput[] = []
  for (let k = 0; k < 200_000; k++) {
    const [action, entityType] = pick(AUDIT_ACTIONS)
    const r = pick(residents)
    audits.push({ at: new Date(now.getTime() - R() * DAYS * 864e5), orgId: org.id, userId: pick(allStaff), action, entityType, entityId: entityType === 'Resident' ? r.id : id('e'), context: { residentId: r.id } })
  }
  await bulk('Audit-Einträge', audits, (c) => db.auditLog.createMany({ data: c }), 10_000)

  await db.$executeRawUnsafe('ANALYZE')
  const counts = await Promise.all([db.location.count(), db.unit.count(), db.resident.count(), db.user.count(), db.observation.count(), db.vitalSign.count(), db.medicationAdministration.count(), db.task.count(), db.auditLog.count()])
  console.log('Gesamt: Standorte %d, Wohngruppen %d, Bewohnende %d, Mitarbeitende %d, Verlauf %d, Vitalwerte %d, Abgaben %d, Aufgaben %d, Audit %d', ...counts)
  console.log(`Fertig in ${Math.round((Date.now() - t0) / 1000)} s. Login wie Demo (careos-demo); zusätzlich scale.<n>@lindenhof.ch.`)
}

main().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
