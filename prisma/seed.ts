/**
 * Demodaten "Haus Lindenhof". Alle Personen und Werte sind erfunden.
 * Aufruf: npm run db:seed   (setzt die Datenbank NICHT zurück – nur auf leerer DB verwenden)
 */
import { PrismaClient, type Prisma } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { DEFAULT_ROLES } from '../src/lib/permissions'
import { ASSESSMENTS, CARE_DOMAINS, INCIDENT_TYPES } from '../src/lib/clinical-config'
import { DEFAULT_FORMS } from '../src/lib/forms'

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
const R = rng(4711)
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const now = new Date()
const nowMin = now.getHours() * 60 + now.getMinutes()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const at = (day: Date, time: string) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(toMin(time) / 60), toMin(time) % 60)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000)
const dbDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
const born = (iso: string) => new Date(iso + 'T00:00:00Z')

export async function seedDemo(client: PrismaClient = db) {
  const existing = await client.organization.count()
  if (existing) {
    console.log('Datenbank enthält bereits Daten – Seed übersprungen.')
    return false
  }
  const pw = await hash('careos-demo', { memoryCost: 19456, timeCost: 2, parallelism: 1 })

  const org = await client.organization.create({
    data: { name: 'Stiftung Lindenhof', slug: 'lindenhof', terminology: 'resident', settings: { demo: true, requireMfaForAdmins: false } },
  })
  const loc = await client.location.create({ data: { orgId: org.id, name: 'Haus Lindenhof', address: 'Lindenweg 12, 8000 Zürich', phone: '044 000 00 00' } })
  const loc2 = await client.location.create({ data: { orgId: org.id, name: 'Haus am Bach', address: 'Bachstrasse 3, 8000 Zürich' } })
  const wg1 = await client.unit.create({ data: { orgId: org.id, locationId: loc.id, name: 'Wohngruppe 1', shortName: 'WG 1' } })
  const wg2 = await client.unit.create({ data: { orgId: org.id, locationId: loc.id, name: 'Wohngruppe 2', shortName: 'WG 2' } })
  const bach = await client.unit.create({ data: { orgId: org.id, locationId: loc2.id, name: 'Demenzwohngruppe', shortName: 'DWG' } })
  void bach

  const rooms: Record<string, string> = {}
  for (const n of ['201', '202', '203', '204', '205', '206', '207', '208']) rooms[n] = (await client.room.create({ data: { unitId: wg2.id, number: n } })).id
  for (const n of ['101', '102', '103', '104']) rooms[n] = (await client.room.create({ data: { unitId: wg1.id, number: n } })).id

  // Rollen
  const roles: Record<string, string> = {}
  for (const r of DEFAULT_ROLES) roles[r.key] = (await client.role.create({ data: { orgId: org.id, key: r.key, name: r.name, permissions: r.permissions, system: true } })).id

  // Schichten
  const st: Record<string, string> = {}
  for (const s of [
    { code: 'F', name: 'Frühdienst', start: '07:00', end: '15:30', color: 'accent' },
    { code: 'S', name: 'Spätdienst', start: '14:45', end: '23:00', color: 'violet' },
    { code: 'N', name: 'Nachtdienst', start: '22:45', end: '07:15', color: 'neutral' },
  ]) st[s.code] = (await client.shiftType.create({ data: { orgId: org.id, ...s } })).id

  const quals = {
    hf: (await client.qualification.create({ data: { orgId: org.id, name: 'Pflegefachperson HF', level: 3 } })).id,
    fage: (await client.qualification.create({ data: { orgId: org.id, name: 'FaGe EFZ', level: 2 } })).id,
    srk: (await client.qualification.create({ data: { orgId: org.id, name: 'Pflegehelfer/in SRK', level: 1 } })).id,
    wound: (await client.qualification.create({ data: { orgId: org.id, name: 'Wundexpertin/Wundexperte SAfW', level: 3 } })).id,
    trainer: (await client.qualification.create({ data: { orgId: org.id, name: 'Berufsbildner/in', level: 2 } })).id,
    bls: (await client.qualification.create({ data: { orgId: org.id, name: 'BLS-AED-SRC', level: 1 } })).id,
  }

  // Personal
  type U = { key: string; first: string; last: string; title: string; role: string; unit?: string | null; qual?: string; email?: string }
  const staff: U[] = [
    { key: 'AM', first: 'Anna', last: 'Muster', title: 'Pflegefachperson HF', role: 'nurse', unit: wg2.id, qual: quals.hf, email: 'anna.muster@lindenhof.ch' },
    { key: 'LR', first: 'Lea', last: 'Rohner', title: 'FaGe', role: 'nurse', unit: wg2.id, qual: quals.fage },
    { key: 'MK', first: 'Mirela', last: 'Kovač', title: 'Pflegehelferin SRK', role: 'care_assistant', unit: wg2.id, qual: quals.srk },
    { key: 'DS', first: 'David', last: 'Steiner', title: 'Pflegefachperson HF', role: 'specialist', unit: wg2.id, qual: quals.hf },
    { key: 'BG', first: 'Barbara', last: 'Gerber', title: 'Stationsleitung', role: 'ward_lead', unit: null, qual: quals.hf, email: 'barbara.gerber@lindenhof.ch' },
    { key: 'TN', first: 'Tim', last: 'Nguyen', title: 'FaGe', role: 'nurse', unit: wg2.id, qual: quals.fage },
    { key: 'SB', first: 'Sandra', last: 'Bühler', title: 'Pflegefachperson HF', role: 'nurse', unit: wg2.id, qual: quals.hf },
    { key: 'JF', first: 'Jonas', last: 'Fischer', title: 'Pflegehelfer SRK', role: 'care_assistant', unit: wg2.id, qual: quals.srk },
    { key: 'NM', first: 'Nadia', last: 'Meier', title: 'Pflegefachperson HF', role: 'nurse', unit: wg1.id, qual: quals.hf },
    { key: 'CW', first: 'Claudia', last: 'Widmer', title: 'Pflegedienstleitung', role: 'nursing_director', unit: null, qual: quals.hf, email: 'claudia.widmer@lindenhof.ch' },
    { key: 'QM', first: 'Reto', last: 'Huber', title: 'Qualitätsmanagement', role: 'quality', unit: null },
    { key: 'HR', first: 'Petra', last: 'Zimmermann', title: 'HR', role: 'hr', unit: null },
    { key: 'PK', first: 'Peter', last: 'Keller', title: 'Hausarzt', role: 'physician', unit: null },
    { key: 'SA', first: 'Simon', last: 'Brandt', title: 'Systemadministration', role: 'sysadmin', unit: null, email: 'admin@lindenhof.ch' },
  ]
  // Personenverzeichnis (PRD §55): dienstliche Nummern (DECT der Wohngruppe), private Nummer nur teilweise freigegeben
  const contact: Record<string, { work?: string; phone?: string; shared?: boolean }> = {
    AM: { work: '044 000 00 21', phone: '079 000 11 22' }, LR: { work: '044 000 00 22', phone: '078 000 33 44', shared: true }, MK: { work: '044 000 00 23' },
    DS: { work: '044 000 00 24' }, BG: { work: '044 000 00 20', phone: '079 000 55 66' }, TN: { work: '044 000 00 25' }, SB: { work: '044 000 00 26' },
    JF: { work: '044 000 00 27' }, NM: { work: '044 000 00 11' }, CW: { work: '044 000 00 10' }, QM: { work: '044 000 00 12' }, HR: { work: '044 000 00 13' },
  }
  const U: Record<string, string> = {}
  for (const s of staff) {
    const email = s.email ?? `${s.first.toLowerCase()}.${s.last.toLowerCase().replace('č', 'c').replace('ü', 'ue')}@lindenhof.ch`
    const u = await client.user.create({
      data: {
        orgId: org.id, email, firstName: s.first, lastName: s.last, initials: s.key, jobTitle: s.title, passwordHash: pw,
        primaryUnitId: s.unit ?? wg2.id, theme: 'light', locale: 'de',
        workPhone: contact[s.key]?.work ?? null, phone: contact[s.key]?.phone ?? null, phoneShared: !!contact[s.key]?.shared,
      },
    })
    U[s.key] = u.id
    // Stationsleitung gilt für den ganzen Standort, Pflege für ihre Wohngruppe
    const scope = s.role === 'ward_lead' ? { locationId: loc.id } : s.unit ? { unitId: s.unit } : {}
    await client.roleAssignment.create({ data: { userId: u.id, roleId: roles[s.role], ...scope } })
    if (s.qual) await client.userQualification.create({ data: { userId: u.id, qualificationId: s.qual } })
  }
  // Zusatzqualifikationen mit Ablaufdaten (Erinnerungen, Profil)
  await client.userQualification.createMany({ data: [
    { userId: U.AM, qualificationId: quals.bls, validUntil: addDays(today, 25) },
    { userId: U.LR, qualificationId: quals.bls, validUntil: addDays(today, 300) },
    { userId: U.DS, qualificationId: quals.wound },
    { userId: U.DS, qualificationId: quals.bls, validUntil: addDays(today, -5) },
    { userId: U.SB, qualificationId: quals.trainer },
    { userId: U.BG, qualificationId: quals.trainer },
  ] })
  const team = await client.team.create({ data: { orgId: org.id, unitId: wg2.id, name: 'Team Wohngruppe 2' } })
  for (const k of ['AM', 'LR', 'MK', 'DS', 'BG', 'TN', 'SB', 'JF']) await client.teamMember.create({ data: { teamId: team.id, userId: U[k] } })

  // Dienstplan: 14 Tage zurück, 28 Tage voraus
  const rota: Record<string, string> = {
    AM: 'SSFF-NN-FFS--SSFF-NNN--FFSS-', LR: 'FFSS--FFNN-SSFF--FFSS-NN--FF', MK: 'F-FFSS--FFSS-F-FFSS--FF-SSF-',
    DS: 'NN--FFSS-SSFF--NNN-FFSS--FFS', TN: '-SSFF-NN--FFSS-SSFF--NN-FFS-', SB: 'SF--SSFF-NN--FFSS-SSF--NNFF', JF: 'FS-FF--SSFF-F-SSFF--FFSS--F',
  }
  for (let d = -14; d <= 28; d++) {
    const day = addDays(today, d)
    for (const [k, pattern] of Object.entries(rota)) {
      const c = pattern[(d + 14) % pattern.length]
      if (c === '-') continue
      await client.shift.create({ data: { unitId: wg2.id, userId: U[k], shiftTypeId: st[c], date: dbDate(day) } })
    }
    if (d === 0) {
      // Anna arbeitet heute: Schicht passend zur aktuellen Uhrzeit, damit die Ansicht "Meine Schicht" lebt.
      const code = nowMin >= 1365 || nowMin < 420 ? 'N' : nowMin >= 885 ? 'S' : 'F'
      // Nachtdienst nach Mitternacht gehört zum Vortag
      const current = code === 'N' && nowMin < 420 ? addDays(day, -1) : day
      const previous = addDays(current, -1)
      await client.shift.deleteMany({ where: { userId: U.AM, date: { in: [dbDate(day), dbDate(current), dbDate(previous)] } } })
      await client.shift.create({ data: { unitId: wg2.id, userId: U.AM, shiftTypeId: st[code], date: dbDate(current) } })
      // Letzter Dienst: Frühdienst am Tag davor
      await client.shift.create({ data: { unitId: wg2.id, userId: U.AM, shiftTypeId: st.F, date: dbDate(previous) } })
    }
  }
  for (const d of [3, 9, 16]) await client.shift.create({ data: { unitId: wg2.id, shiftTypeId: st[d === 9 ? 'N' : 'S'], date: dbDate(addDays(today, d)), status: 'open', requiredQualification: 'Pflegefachperson HF' } })
  await client.absence.create({ data: { userId: U.LR, kind: 'vacation', from: dbDate(addDays(today, 10)), to: dbDate(addDays(today, 17)), status: 'approved', decidedById: U.BG, decidedAt: minsAgo(4000) } })
  await client.absence.create({ data: { userId: U.TN, kind: 'vacation', from: dbDate(addDays(today, 20)), to: dbDate(addDays(today, 24)), status: 'requested' } })
  await client.absence.create({ data: { userId: U.MK, kind: 'sick', from: dbDate(addDays(today, -3)), to: dbDate(addDays(today, -2)), status: 'approved', decidedById: U.BG } })

  // Klinische Konfiguration
  for (const [i, d] of CARE_DOMAINS.entries()) await client.careDomain.create({ data: { orgId: org.id, key: d.key, name: d.de, order: i } })
  for (const a of ASSESSMENTS) await client.assessmentDefinition.create({ data: { orgId: org.id, key: a.key, name: a.name, description: a.description, items: a.items as unknown as Prisma.InputJsonValue, intervalDays: a.intervalDays } })
  for (const f of DEFAULT_FORMS) await client.formDefinition.create({ data: { orgId: org.id, key: f.key, name: f.name, category: f.category, description: f.description, fields: f.fields as unknown as Prisma.InputJsonValue, active: true } })
  const itypes: Record<string, string> = {}
  for (const it of INCIDENT_TYPES) itypes[it.key] = (await client.incidentType.create({ data: { orgId: org.id, key: it.key, name: it.de, workflow: it.workflow as unknown as Prisma.InputJsonValue } })).id
  const LIMITS = { sys: [100, 150], dia: [50, 90], pulse: [55, 100], temp: [36.0, 37.9], spo2: [92, 100], glucose: [4, 10], respRate: [12, 20], pain: [0, 3] }
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) await client.vitalThreshold.create({ data: { orgId: org.id, key, lo, hi } })

  // Bewohnende (Werte aus dem Stationsarbeitsplatz-Entwurf)
  type Raw = {
    room: string; last: string; first: string; born: string; level: number; gp: string; ref: string; rea: boolean; sex: 'f' | 'm'
    allergies: string[]; risks: string[]; diabetic: boolean; diet: string; mobility: string
    base: Record<string, number>; today: Record<string, number>; keepOpen: string[]
    extra: [string, string, string, number][]; skip?: string[]
    meds: [string, string, string, number[] | string[]][]; reserve: [string, string, string, number][]
    notes: [number, string, string, string][]; refused: [number, number] | null
  }
  const RAW: Raw[] = [
    { room: '201', last: 'Brunner', first: 'Ruth', born: '1938-03-14', level: 8, gp: 'Dr. med. P. Keller', ref: 'LR', rea: false, sex: 'f',
      allergies: ['Penicillin'], risks: ['Sturzrisiko', 'Diabetes Typ 2'], diabetic: true, diet: 'Diabetische Kost', mobility: 'Rollator, Begleitung bei Transfers',
      base: { sys: 136, dia: 78, pulse: 74, temp: 36.6, spo2: 95, glucose: 8.0 }, today: { glucose: 11.8 }, keepOpen: ['10:00'],
      extra: [['07:15', 'BZ-Messung vor Frühstück', 'Behandlungspflege', 5], ['16:30', 'BZ-Messung vor Abendessen', 'Behandlungspflege', 5]],
      meds: [['Metformin 500 mg', 'Tbl.', 'Diabetes Typ 2', [1, 0, 1, 0]], ['Amlodipin 5 mg', 'Tbl.', 'Hypertonie', [1, 0, 0, 0]], ['Pantoprazol 20 mg', 'Tbl.', 'Magenschutz', [1, 0, 0, 0]], ['Calcium/Vit. D3 500/800', 'Kautbl.', 'Osteoporose', [0, 1, 0, 0]]],
      reserve: [['Paracetamol 500 mg', '1 Tbl.', 'Schmerzen NRS ≥ 4', 4]],
      notes: [[48, 'care', 'LR', 'Abendtoilette mit Unterstützung im Bad durchgeführt. Haut am Gesäss intakt. Gangbild unsicher, Rollator konsequent genutzt.'],
        [262, 'observation', 'DS', 'BZ vor dem Abendessen 11,8 mmol/l, Frau Brunner hatte am Nachmittag Kuchen beim Besuch. Hausarzt per HIN-Mail informiert, Kontrolle morgen nüchtern.'],
        [1510, 'relatives', 'MK', 'Tochter (Frau S. Brunner) hat angerufen, kommt am Samstag zum Mittagessen. Wünscht Rückruf wegen neuer Brille.']], refused: null },
    { room: '202', last: 'Gisler', first: 'Walter', born: '1941-07-02', level: 6, gp: 'Dr. med. P. Keller', ref: 'MK', rea: true, sex: 'm',
      allergies: [], risks: ['Weglaufgefährdung', 'Demenz'], diabetic: false, diet: 'Vollkost', mobility: 'selbstständig, Orientierungshilfe',
      base: { sys: 128, dia: 74, pulse: 68, temp: 36.5, spo2: 96 }, today: {}, keepOpen: [],
      extra: [['15:00', 'Gedächtnistraining Gruppe', 'Aktivierung', 45]],
      meds: [['Donepezil 10 mg', 'Tbl.', 'Demenz', [0, 0, 0, 1]], ['Quetiapin 25 mg', 'Tbl.', 'Unruhe abends', [0, 0, 0, 1]], ['Torasemid 5 mg', 'Tbl.', 'Ödeme', [1, 0, 0, 0]]],
      reserve: [['Lorazepam 0,5 mg', '1 Tbl. s.l.', 'starke Unruhe/Angst', 2]],
      notes: [[95, 'observation', 'LR', 'Ab 19 Uhr zunehmend unruhig, wollte "nach Hause zur Arbeit". Mit Fotoalbum im Aufenthaltsraum beruhigt. Keine Reserve nötig.'],
        [610, 'care', 'MK', 'Hat am Gedächtnistraining aktiv teilgenommen, Liedtexte vollständig gekannt.']], refused: [1, 3] },
    { room: '203', last: 'Huber', first: 'Margrit', born: '1935-11-21', level: 10, gp: 'Dr. med. A. Rüegg', ref: 'DS', rea: false, sex: 'f',
      allergies: [], risks: ['Palliativ', 'Dekubitus Braden 12'], diabetic: false, diet: 'Wunschkost, angedickt', mobility: 'bettlägerig, Lagerung alle 4 h',
      base: { sys: 112, dia: 64, pulse: 88, temp: 37.2, spo2: 92 }, today: { spo2: 89, temp: 38.1 }, keepOpen: ['17:00'],
      extra: [['09:00', 'Lagerungswechsel 30°', 'Behandlungspflege', 10], ['11:00', 'Mundpflege palliativ', 'Behandlungspflege', 10], ['13:00', 'Lagerungswechsel 30°', 'Behandlungspflege', 10], ['17:00', 'Lagerungswechsel 30°', 'Behandlungspflege', 10], ['21:00', 'Lagerungswechsel 30°', 'Behandlungspflege', 10]],
      skip: ['10:00'],
      meds: [['Morphin Tropfen 2 mg', 'gtt.', 'Schmerz/Atemnot', [1, 1, 1, 1]], ['Movicol', 'Btl.', 'Obstipationsprophylaxe', [1, 0, 0, 0]]],
      reserve: [['Morphin 2 mg', 's.c.', 'Atemnot oder Schmerz', 6], ['Butylscopolamin 20 mg', 's.c.', 'Rasselatmung', 3]],
      notes: [[35, 'observation', 'DS', 'Temp. 38,1 °C, SpO₂ 89 % bei Raumluft. Atmung oberflächlich, keine Rasselgeräusche. Oberkörper hochgelagert. Familie gemäss Palliativplan nicht nachts informieren.'],
        [190, 'physician', 'DS', 'Telefonat Dr. Rüegg: keine Hospitalisation, symptomatische Therapie, Morphin Reserve weiter wie verordnet.'],
        [400, 'relatives', 'LR', 'Sohn war 2 Stunden zu Besuch, hat vorgelesen. Bittet um Anruf bei Verschlechterung, Tel. im Notfallblatt.']], refused: null },
    { room: '204', last: 'Zürcher', first: 'Hans-Peter', born: '1944-01-30', level: 4, gp: 'Dr. med. P. Keller', ref: 'LR', rea: true, sex: 'm',
      allergies: ['Jod-Kontrastmittel'], risks: ['Antikoagulation'], diabetic: false, diet: 'Vollkost, Vitamin-K-arm', mobility: 'selbstständig',
      base: { sys: 146, dia: 86, pulse: 62, temp: 36.4, spo2: 96 }, today: { sys: 162, dia: 94 }, keepOpen: [],
      extra: [['08:30', 'INR-Kontrolle (Labor)', 'Behandlungspflege', 10]],
      meds: [['Phenprocoumon 3 mg', 'Tbl.', 'nach INR-Schema', [0, 0, 1, 0]], ['Bisoprolol 2,5 mg', 'Tbl.', 'Hypertonie', [1, 0, 0, 0]], ['Atorvastatin 20 mg', 'Tbl.', 'Hyperlipidämie', [0, 0, 1, 0]]],
      reserve: [['Nitroglycerin 0,4 mg', '1 Hub', 'Brustschmerz', 3]],
      notes: [[150, 'observation', 'LR', 'BD 162/94 mmHg nach Spaziergang, nach 15 Min. Ruhe 154/90. Keine Beschwerden. Kontrolle morgen früh.'],
        [700, 'physician', 'DS', 'INR 2,6 (Ziel 2–3). Dosis unverändert 3 mg gemäss Schema.']], refused: null },
    { room: '205', last: 'Frei', first: 'Elisabeth', born: '1939-05-08', level: 7, gp: 'Dr. med. A. Rüegg', ref: 'MK', rea: false, sex: 'f',
      allergies: [], risks: ['Schluckstörung', 'Aspirationsgefahr'], diabetic: false, diet: 'Püriert, Getränke angedickt', mobility: 'Rollstuhl',
      base: { sys: 124, dia: 70, pulse: 76, temp: 36.7, spo2: 95 }, today: {}, keepOpen: [],
      extra: [['14:30', 'Trinkprotokoll Zwischenbilanz', 'Überwachung', 5]],
      meds: [['Mirtazapin 15 mg', 'Tbl. zermörsert', 'Depression/Schlaf', [0, 0, 0, 1]], ['Esomeprazol 20 mg', 'Granulat', 'Reflux', [1, 0, 0, 0]], ['Vitamin D3', '4 gtt.', 'Substitution', [1, 0, 0, 0]]],
      reserve: [['Paracetamol Sirup 500 mg', '10 ml', 'Schmerzen', 4]],
      notes: [[120, 'care', 'MK', 'Abendessen püriert zu ¾ gegessen, Trinkmenge bis 19 Uhr 1050 ml. Nach dem Essen 30 Min. aufrecht gesessen, kein Husten.'],
        [900, 'observation', 'LR', 'Leichtes Husten beim Trinken von Kaffee ohne Andickungsmittel (Besuch hat gebracht). Angehörige nochmals informiert.']], refused: null },
    { room: '206', last: 'Baumann', first: 'Anton', born: '1946-09-17', level: 5, gp: 'Dr. med. P. Keller', ref: 'DS', rea: true, sex: 'm',
      allergies: [], risks: ['Diabetes Typ 1', 'Hypoglykämierisiko'], diabetic: true, diet: 'Diabetische Kost', mobility: 'selbstständig',
      base: { sys: 132, dia: 80, pulse: 72, temp: 36.6, spo2: 97, glucose: 7.4 }, today: {}, keepOpen: ['17:00'],
      extra: [['07:00', 'BZ + Insulin nach Schema', 'Behandlungspflege', 10], ['11:30', 'BZ + Insulin nach Schema', 'Behandlungspflege', 10], ['17:00', 'BZ + Insulin nach Schema', 'Behandlungspflege', 10]],
      meds: [['Insulin glargin', 's.c.', 'Basalinsulin', ['0', '0', '0', '18 IE']], ['Insulin aspart', 's.c.', 'Korrektur', ['n. Schema', 'n. Schema', 'n. Schema', '0']], ['Lisinopril 10 mg', 'Tbl.', 'Nephroprotektion', [1, 0, 0, 0]]],
      reserve: [['Glukose-Gel 40 %', '1 Tube', 'BZ < 4 mmol/l', 3]],
      notes: [[300, 'observation', 'DS', 'BZ 3,9 mmol/l um 16 Uhr, leicht schwitzig. 1 Glas Orangensaft, nach 15 Min. 6,2 mmol/l. Insulindosis Mittag kritisch prüfen.']], refused: null },
    { room: '207', last: 'Schmid', first: 'Verena', born: '1937-12-03', level: 9, gp: 'Dr. med. A. Rüegg', ref: 'LR', rea: false, sex: 'f',
      allergies: ['Latex'], risks: ['Sturzrisiko', 'Inkontinenz'], diabetic: false, diet: 'Vollkost', mobility: 'Rollator, nachts Begleitung',
      base: { sys: 118, dia: 68, pulse: 80, temp: 36.8, spo2: 94 }, today: {}, keepOpen: ['19:30'],
      extra: [['10:30', 'Inkontinenzversorgung', 'Grundpflege', 10], ['15:30', 'Inkontinenzversorgung', 'Grundpflege', 10]],
      meds: [['Trospium 20 mg', 'Tbl.', 'Dranginkontinenz', [1, 0, 1, 0]], ['Sertralin 50 mg', 'Tbl.', 'Depression', [1, 0, 0, 0]], ['Paracetamol 1 g', 'Tbl.', 'Arthroseschmerz', [1, 1, 1, 0]]],
      reserve: [['Tramadol 50 mg', '1 Kps.', 'Schmerzen NRS ≥ 6', 2]],
      notes: [[75, 'incident', 'MK', 'Sturz um 20:50 im Zimmer beim Gang zur Toilette, ohne Rufglocke. Sitzend am Boden vorgefunden, kein Kopfanprall, beide Beine bewegen sich schmerzfrei. Sturzprotokoll erfasst, Bettalarm aktiviert.'],
        [520, 'care', 'LR', 'Mobilisation mit Rollator 2× über den Gang, gut gegangen.']], refused: null },
    { room: '208', last: 'Ammann', first: 'Kurt', born: '1940-04-26', level: 3, gp: 'Dr. med. P. Keller', ref: 'MK', rea: true, sex: 'm',
      allergies: [], risks: [], diabetic: false, diet: 'Vollkost', mobility: 'selbstständig',
      base: { sys: 130, dia: 76, pulse: 70, temp: 36.5, spo2: 97 }, today: {}, keepOpen: [],
      extra: [['15:30', 'Spaziergang Garten (begleitet)', 'Aktivierung', 30]], skip: ['06:45', '19:30'],
      meds: [['Tamsulosin 0,4 mg', 'Kps.', 'Prostatahyperplasie', [0, 0, 1, 0]], ['Acetylsalicylsäure 100 mg', 'Tbl.', 'Sekundärprophylaxe', [1, 0, 0, 0]]],
      reserve: [], notes: [[180, 'care', 'MK', 'Selbstständig geduscht, wünscht morgen Coiffeur-Termin. Terminbuch eingetragen.']], refused: null },
  ]
  const SLOTS = ['07:30', '12:00', '17:30', '21:00']
  const BASE: [string, string, string, number, string][] = [
    ['06:45', 'Grundpflege Morgen, Ankleiden', 'Grundpflege', 25, 'hygiene'],
    ['08:00', 'Frühstück begleiten', 'Ernährung', 15, 'nutrition'],
    ['10:00', 'Mobilisation / Gehtraining', 'Mobilität', 15, 'mobility'],
    ['12:00', 'Mittagessen begleiten', 'Ernährung', 15, 'nutrition'],
    ['19:30', 'Abendtoilette', 'Grundpflege', 20, 'hygiene'],
    ['21:30', 'Kontrollgang', 'Überwachung', 5, 'safety'],
  ]
  const SI = ['LR', 'MK', 'DS']
  const residentIds: Record<string, string> = {}

  for (const [i, r] of RAW.entries()) {
    const res = await client.resident.create({
      data: {
        orgId: org.id, unitId: wg2.id, roomId: rooms[r.room], firstName: r.first, lastName: r.last, birthDate: born(r.born), sex: r.sex,
        careLevel: r.level, physician: r.gp, primaryNurseId: U[r.ref], rea: r.rea ? 'yes' : 'no', allergies: r.allergies, risks: r.risks,
        diet: r.diet, mobility: r.mobility, admittedAt: addDays(today, -200 - i * 97),
        importantNotes: r.risks.includes('Palliativ') ? 'Palliative Betreuung gemäss Notfallplan. Keine Hospitalisation.' : null,
      },
    })
    residentIds[r.room] = res.id
    await client.contact.create({ data: { residentId: res.id, name: `${r.sex === 'f' ? 'Sohn' : 'Tochter'} ${r.last}`, relation: r.sex === 'f' ? 'Sohn' : 'Tochter', phone: '079 000 00 ' + r.room.slice(1), isEmergency: true, isLegalRep: i % 3 === 0 } })
    await client.contact.create({ data: { residentId: res.id, name: r.gp, relation: 'Hausarzt', phone: '044 111 22 ' + (30 + i), email: 'praxis@example.ch' } })

    // Pflegeplanung mit Interventionen → erzeugt den Tagesplan
    const plan = await client.carePlan.create({
      data: { residentId: res.id, status: 'active', createdById: U[r.ref], approvedById: U.DS, approvedAt: addDays(today, -40), createdAt: addDays(today, -45), nextEvaluation: addDays(today, 14 + i * 3) },
    })
    const areaIds: Record<string, string> = {}
    const areaDefs: Record<string, Partial<Prisma.CarePlanAreaCreateInput>> = {
      mobility: { situation: r.mobility, resources: 'Motiviert, versteht Anleitung', needs: 'Begleitung bei längeren Strecken', risks: r.risks.includes('Sturzrisiko') ? 'Erhöhtes Sturzrisiko' : null, goal: 'Gehfähigkeit erhalten, keine Stürze', evaluateBy: addDays(today, 21) },
      hygiene: { situation: 'Teilweise selbstständig', resources: 'Wäscht Gesicht und Hände selbst', needs: 'Unterstützung Rücken, Beine, Intimpflege', goal: 'Hautintegrität erhalten', evaluateBy: addDays(today, 30) },
      nutrition: { situation: r.diet, needs: r.risks.includes('Schluckstörung') ? 'Angedickte Getränke, aufrechte Position' : 'Menüwahl unterstützen', goal: 'Gewicht stabil, Trinkmenge ≥ 1500 ml', evaluateBy: addDays(today, 14) },
      safety: { situation: 'Nächtliche Kontrollgänge', goal: 'Sicherheit in der Nacht', evaluateBy: addDays(today, 60) },
    }
    for (const [domain, def] of Object.entries(areaDefs)) {
      areaIds[domain] = (await client.carePlanArea.create({ data: { carePlanId: plan.id, domain, ...def } as Prisma.CarePlanAreaUncheckedCreateInput })).id
    }
    const skip = r.skip ?? []
    for (const [time, title, cat, dur, domain] of BASE) {
      if (skip.includes(time)) continue
      await client.intervention.create({ data: { residentId: res.id, areaId: areaIds[domain], title, category: cat, times: [time], durationMin: dur } })
    }
    for (const [time, title, cat, dur] of r.extra) {
      await client.intervention.create({ data: { residentId: res.id, areaId: areaIds[cat === 'Aktivierung' ? 'mobility' : 'hygiene'], title, category: cat, times: [time], durationMin: dur } })
    }

    // Medikation
    const medIds: string[] = []
    for (const [name, form, ind, dose] of r.meds) {
      const m = await client.medication.create({
        data: {
          residentId: res.id, name, form, indication: ind, route: form.includes('s.c.') ? 's.c.' : 'p.o.', kind: 'regular', times: SLOTS, doses: dose.map(String),
          prescriber: r.gp, createdById: U.DS, startDate: addDays(today, -90), createdAt: addDays(today, -90), requiresDoubleCheck: name.includes('Morphin') || name.includes('Insulin'),
          stock: 20 + Math.floor(R() * 60), stockUnit: 'Stk.',
        },
      })
      medIds.push(m.id)
    }
    for (const [name, dose, ind, max] of r.reserve) {
      await client.medication.create({
        data: { residentId: res.id, name, form: dose, indication: ind, kind: 'prn', prnDose: dose, prnMaxPerDay: max, prnMinIntervalH: 4, route: dose.includes('s.c.') ? 's.c.' : 'p.o.', times: [], doses: [], prescriber: r.gp, createdById: U.DS, startDate: addDays(today, -60), createdAt: addDays(today, -60), stock: 10, stockUnit: 'Stk.' },
      })
    }
    // Abgaben gestern (vollständig) und heute für vergangene Zeitpunkte
    for (const dayOff of [-1, 0]) {
      const day = addDays(today, dayOff)
      for (const [mi, [, , , dose]] of r.meds.entries()) {
        for (const [si, time] of SLOTS.entries()) {
          const d = dose[si]
          if (!d || d === '0' || d === 0) continue
          if (dayOff === 0 && toMin(time) >= nowMin - 30) continue
          const refused = dayOff === 0 && r.refused && r.refused[0] === mi && r.refused[1] === si
          await client.medicationAdministration.create({
            data: { medicationId: medIds[mi], residentId: res.id, scheduledFor: at(day, time), status: refused ? 'refused' : 'given', dose: String(d), at: new Date(at(day, time).getTime() + (2 + Math.floor(R() * 12)) * 60_000), byId: U[SI[(i + si + mi) % 3]], note: refused ? 'Lehnt Einnahme ab, später nochmals angeboten.' : null },
          })
        }
      }
    }

    // Vitalwerte: 6 Tage + heute
    const j = (b: number, s: number) => b + (R() - 0.5) * 2 * s
    for (let d = 6; d >= 0; d--) {
      const t = d === 0 ? minsAgo(140) : at(addDays(today, -d), '08:00')
      const v = {
        sys: Math.round(j(r.base.sys, 8)), dia: Math.round(j(r.base.dia, 5)), pulse: Math.round(j(r.base.pulse, 5)), temp: +j(r.base.temp, 0.22).toFixed(1),
        spo2: Math.min(100, Math.round(j(r.base.spo2, 1.2))), glucose: r.diabetic ? +j(r.base.glucose, 1.3).toFixed(1) : null,
        weight: +(62 + i * 3 + (R() - 0.5) * 0.8 - (r.room === '205' ? (6 - d) * 0.15 : 0)).toFixed(1),
      }
      Object.assign(v, d === 0 ? r.today : {})
      await client.vitalSign.create({ data: { residentId: res.id, at: t, recordedById: U[SI[(i + d) % 3]], ...v, glucose: v.glucose ?? undefined, pulse: v.pulse } })
    }

    // Pflegebericht
    for (const [m, cat, by, text] of r.notes) {
      await client.observation.create({ data: { residentId: res.id, at: minsAgo(m), category: cat as never, text, authorId: U[by], important: cat === 'incident' } })
    }
    for (let d = 2; d <= 6; d++) {
      await client.observation.create({ data: { residentId: res.id, at: at(addDays(today, -d), '06:30'), category: 'care', text: 'Nacht ruhig verlaufen, mehrmals schlafend angetroffen. Keine Auffälligkeiten.', authorId: U[d % 2 ? 'DS' : 'TN'] } })
    }

    // Termine
    if (i % 2 === 0) await client.appointment.create({ data: { residentId: res.id, at: at(addDays(today, 1 + (i % 4)), '09:30'), title: 'Arztvisite ' + r.gp, kind: 'physician', createdById: U.BG } })
    if (r.room === '208') await client.appointment.create({ data: { residentId: res.id, at: at(addDays(today, 1), '10:00'), title: 'Coiffeur', kind: 'other', createdById: U.MK } })

    // Ernährung
    await client.nutritionProfile.create({
      data: {
        residentId: res.id, dietForm: r.diet, texture: r.risks.includes('Schluckstörung') ? 'püriert' : r.room === '203' ? 'angedickt' : 'normal', intolerances: r.allergies.filter((a) => a.includes('Latex') ? false : false),
        swallowing: r.risks.includes('Schluckstörung') ? 'Dysphagie, Getränke Stufe 2 (nektarartig)' : null, fluidTargetMl: 1500, supplements: r.room === '203' ? 'Trinknahrung 1× täglich' : null,
      },
    })
  }

  // Tagesaufgaben heute erzeugen und Vergangenes quittieren (wie im Entwurf)
  const ivs = await client.intervention.findMany({ where: { resident: { unitId: wg2.id } }, include: { resident: true } })
  // Gestern vollständig quittiert, heute bis vor 30 Minuten (unabhängig davon, wann der Seed läuft)
  let n = 0
  for (const dayOff of [-1, 0]) {
    const day = addDays(today, dayOff)
    const isDone = (time: string, keepOpen: string[] = []) => dayOff < 0 || (toMin(time) < nowMin - 30 && !keepOpen.includes(time))
    for (const iv of ivs) {
      const raw = RAW.find((x) => x.room && residentIds[x.room] === iv.residentId)!
      for (const time of iv.times) {
        const done = isDone(time, raw.keepOpen)
        await client.task.create({
          data: {
            orgId: org.id, unitId: wg2.id, residentId: iv.residentId, title: iv.title, category: iv.category, dueAt: at(day, time), durationMin: iv.durationMin,
            source: 'careplan', sourceId: iv.id, status: done ? 'done' : 'planned', completedById: done ? U[SI[n++ % 3]] : null,
            completedAt: done ? new Date(at(day, time).getTime() + (4 + Math.floor(R() * 14)) * 60_000) : null,
          },
        })
      }
    }
    // Medikamenten-Slots
    for (const [room, rid] of Object.entries(residentIds)) {
      const raw = RAW.find((x) => x.room === room)!
      for (const [si, time] of SLOTS.entries()) {
        if (!raw.meds.some((m) => m[3][si] && m[3][si] !== '0' && m[3][si] !== 0)) continue
        const done = isDone(time)
        await client.task.create({
          data: { orgId: org.id, unitId: wg2.id, residentId: rid, title: 'medication.slot', category: 'Medikation', dueAt: at(day, time), durationMin: 5, source: 'medication', sourceId: `${rid}:${time}`, status: done ? 'done' : 'planned', completedById: done ? U.LR : null, completedAt: done ? at(day, time) : null },
        })
      }
    }
  }
  await client.task.create({ data: { orgId: org.id, unitId: wg2.id, residentId: residentIds['208'], title: 'Coiffeur-Termin bestätigen', category: 'Organisation', dueAt: at(today, '16:00'), durationMin: 5, source: 'manual', createdById: U.MK, priority: 'routine' } })

  // Assessments
  const ass = async (room: string, key: string, score: number, result: string, days: number, nextDue: number) =>
    client.assessment.create({ data: { residentId: residentIds[room], key, score, result, answers: {}, authorId: U.DS, at: addDays(today, -days), nextDue: addDays(today, nextDue) } })
  await ass('203', 'braden', 12, 'hohes Risiko', 6, 1)
  await ass('201', 'fallrisk', 4, 'erhöhtes Risiko', 20, 10)
  await ass('207', 'fallrisk', 5, 'erhöhtes Risiko', 40, 0)
  await ass('205', 'mna', 9, 'Risiko für Mangelernährung', 25, 5)
  await ass('203', 'nrs', 3, 'leichte Schmerzen', 0, 0)

  // Wunde Frau Huber
  const wound = await client.wound.create({ data: { residentId: residentIds['203'], bodySite: 'Sakrum', kind: 'Dekubitus', classification: 'Kategorie 2', origin: 'im Haus entstanden', startedAt: addDays(today, -18), createdById: U.DS } })
  for (const [d, l, w] of [[18, 32, 25], [11, 28, 22], [4, 22, 18]]) {
    await client.woundAssessment.create({ data: { woundId: wound.id, at: addDays(today, -d), lengthMm: l, widthMm: w, depthMm: 2, exudate: 'gering, serös', tissue: 'Granulation', edge: 'reizlos', pain: 2, treatment: 'Reinigung NaCl 0,9 %, Hydrokolloidverband', material: 'Hydrokolloid 10×10 cm', nextChange: addDays(today, -d + 3), authorId: U.DS } })
  }
  await client.wound.update({ where: { id: wound.id }, data: { status: 'healing' } })

  // Trinkprotokoll Frau Frei
  for (const [m, ml, item] of [[600, 200, 'Tee angedickt'], [520, 150, 'Wasser angedickt'], [420, 200, 'Suppe'], [300, 250, 'Tee angedickt'], [180, 150, 'Saft angedickt'], [100, 100, 'Wasser angedickt']] as const) {
    await client.intakeLog.create({ data: { residentId: residentIds['205'], at: minsAgo(m), kind: 'drink', amountMl: ml, item, authorId: U.MK } })
  }
  await client.intakeLog.create({ data: { residentId: residentIds['205'], at: minsAgo(540), kind: 'meal', item: 'Frühstück püriert', portion: 0.75, authorId: U.MK } })

  // Flüssigkeitsbilanz Frau Huber (palliativ, Dauerkatheter): s.c.-Infusion und Urin (PRD §14)
  for (const [m, kind, ml, item] of [[480, 'out_urine', 350, 'Dauerkatheter'], [400, 'in_infusion', 500, 'NaCl 0,9 % s.c.'], [180, 'out_urine', 300, 'Dauerkatheter']] as const) {
    await client.intakeLog.create({ data: { residentId: residentIds['203'], at: minsAgo(m), kind, amountMl: ml, item, authorId: U.MK } })
  }

  // Korrektur einer Messung (PRD §35): Tippfehler Temperatur, storniert mit Begründung und korrigiert – nie überschrieben
  {
    const t0 = at(addDays(today, -1), '14:10')
    const wrong = await client.vitalSign.create({ data: { residentId: residentIds['204'], at: t0, recordedById: U.LR, temp: 39.7, pulse: 76, voidedAt: new Date(t0.getTime() + 12 * 60_000), voidedById: U.LR, voidReason: 'Tippfehler, gemessen 36,7 °C' } })
    await client.vitalSign.create({ data: { residentId: residentIds['204'], at: t0, recordedById: U.LR, temp: 36.7, pulse: 76, supersedesId: wrong.id } })
  }

  // Sturz Frau Schmid als Qualitätsereignis inkl. Folgeprozess
  const fall = await client.incident.create({
    data: {
      orgId: org.id, unitId: wg2.id, residentId: residentIds['207'], typeId: itypes.fall, occurredAt: minsAgo(75), place: 'Zimmer 207, neben dem Bett',
      description: 'Beim Gang zur Toilette ohne Rufglocke gestürzt. Sitzend am Boden vorgefunden.', immediateActions: 'Vitalzeichen kontrolliert, Bettalarm aktiviert, Hilfe beim Aufstehen mit zwei Personen.',
      severity: 'minor', stage: 'followup', reportedById: U.MK,
    },
  })
  for (const [k, title, offset, done] of [['assessment', 'Sturzassessment durchführen', 60, false], ['vitals', 'Vitalwertkontrolle', 15, true], ['physician', 'Hausarzt informieren', 120, false], ['careplan', 'Pflegeplanung prüfen', 1440, false], ['followup', 'Verlaufskontrolle nach 24 h', 1440, false]] as const) {
    const due = new Date(minsAgo(75).getTime() + offset * 60_000)
    const task = await client.task.create({ data: { orgId: org.id, unitId: wg2.id, residentId: residentIds['207'], title: 'incident.' + k, category: 'Qualität', dueAt: due, durationMin: 10, source: 'quality', sourceId: fall.id + ':' + k, priority: 'important', status: done ? 'done' : 'planned', completedById: done ? U.MK : null, completedAt: done ? minsAgo(60) : null } })
    await client.incidentAction.create({ data: { incidentId: fall.id, title, dueAt: due, taskId: task.id, doneAt: done ? minsAgo(60) : null, doneById: done ? U.MK : null } })
  }
  await client.incident.create({ data: { orgId: org.id, unitId: wg2.id, residentId: residentIds['202'], typeId: itypes.medication, occurredAt: addDays(today, -9), description: 'Quetiapin abends doppelt gerichtet, vor Abgabe bemerkt.', nearMiss: true, severity: 'none', stage: 'closed', reportedById: U.LR, closedById: U.QM, closedAt: addDays(today, -5), analysis: 'Dosett-Richten unter Zeitdruck, Störung durch Rufglocke.', conclusion: 'Richten nur noch im Medikamentenraum, Störungsfrei-Weste eingeführt.' } })
  await client.incident.create({ data: { orgId: org.id, unitId: wg2.id, residentId: residentIds['201'], typeId: itypes.fall, occurredAt: addDays(today, -23), description: 'Sturz im Bad, Hämatom Oberarm rechts.', severity: 'minor', stage: 'closed', reportedById: U.DS, closedById: U.BG, closedAt: addDays(today, -15) } })
  await client.incident.create({ data: { orgId: org.id, unitId: wg1.id, typeId: itypes.technical, occurredAt: addDays(today, -2), description: 'Rufanlage Zimmer 103 ausgefallen, Haustechnik informiert.', severity: 'moderate', stage: 'assessment', reportedById: U.NM } })

  // Aufgaben und Workflows (PRD §9.2, §12.1, §22, §45): wiederkehrende Aufgaben, eigenes Assessment-Instrument,
  // fällige Evaluationen der Pflegeplanung, zugewiesene Ereignis-Massnahme. Smart-Workflow-Aufgaben (Nachkontrolle
  // auffälliger Vitalwerte, Lagerungsplan bei Braden ≤ 12) erzeugt die App selbst beim ersten Aufruf.
  {
    const start = dbDate(addDays(today, -30))
    const tpl = (data: Omit<Prisma.TaskTemplateUncheckedCreateInput, 'orgId' | 'unitId' | 'startDate' | 'createdById'>) =>
      client.taskTemplate.create({ data: { orgId: org.id, unitId: wg2.id, startDate: start, createdById: U.BG, ...data } })
    const fridge = await tpl({ title: 'Kühlschranktemperatur Medikamente kontrollieren (2–8 °C) und eintragen', category: 'Organisation', rhythm: 'daily', times: ['07:00'], durationMin: 5 })
    await tpl({ title: 'Notfallkoffer und Sauerstoff prüfen (Vollständigkeit, Verfalldaten, Füllstand)', category: 'Organisation', rhythm: 'weekly', weekdays: [1], times: ['10:00'], durationMin: 15, assigneeId: U.DS, priority: 'important' })
    await tpl({ title: 'Betäubungsmittel-Bestand kontrollieren (Vier-Augen-Prinzip)', category: 'Medikation', rhythm: 'monthly', monthDay: 1, times: ['14:00'], durationMin: 30, priority: 'important' })
    await tpl({ title: 'Wechseldruckmatratze: Funktion und Einstellung prüfen', category: 'Behandlungspflege', rhythm: 'weekly', weekdays: [3, 6], times: ['14:30'], durationMin: 5, residentId: residentIds['203'] })
    // Gestern und heute bis vor 30 Minuten wie die übrigen Aufgaben quittiert
    for (const day of [addDays(today, -1), today]) {
      const due = at(day, '07:00')
      const done = due.getTime() < now.getTime() - 30 * 60_000
      if (day === today && !done && due > now) continue
      await client.task.create({ data: { orgId: org.id, unitId: wg2.id, title: fridge.title, category: fridge.category, dueAt: due, durationMin: 5, source: 'recurring', sourceId: fridge.id, createdById: U.BG, status: done ? 'done' : 'planned', completedById: done ? U.LR : null, completedAt: done ? new Date(due.getTime() + 6 * 60_000) : null } })
    }

    // Eigenes Instrument: BESD (Beurteilung von Schmerzen bei Demenz, deutsche Fassung des PAINAD)
    const o = (...labels: string[]) => labels.map((label, v) => ({ v, label }))
    await client.assessmentDefinition.create({
      data: {
        orgId: org.id, key: 'besd', name: 'BESD – Schmerz bei Demenz', intervalDays: 7,
        description: 'Fremdeinschätzung bei eingeschränkter Kommunikation. Beobachtung während 2 Minuten, ab 2 Punkten sind Schmerzen wahrscheinlich.',
        items: {
          questions: [
            { key: 'q1', label: 'Atmung (unabhängig von Lautäusserungen)', options: o('normal', 'gelegentlich angestrengt, kurze Phasen von Hyperventilation', 'lautstark angestrengt, lange Phasen von Hyperventilation, Cheyne-Stokes-Atmung') },
            { key: 'q2', label: 'Negative Lautäusserung', options: o('keine', 'gelegentlich stöhnen oder ächzen, sich leise negativ äussern', 'wiederholt beunruhigt rufen, laut stöhnen oder ächzen, weinen') },
            { key: 'q3', label: 'Gesichtsausdruck', options: o('lächelnd oder nichtssagend', 'trauriger, ängstlicher oder sorgenvoller Blick', 'grimassieren') },
            { key: 'q4', label: 'Körpersprache', options: o('entspannt', 'angespannt, nervös hin und her gehen, nesteln', 'starr, geballte Fäuste, angezogene Knie, sich entziehen oder wegstossen, schlagen') },
            { key: 'q5', label: 'Trost', options: o('trösten nicht notwendig', 'ablenken oder beruhigen durch Stimme oder Berührung möglich', 'trösten, ablenken, beruhigen nicht möglich') },
          ],
          ranges: [
            { min: 0, max: 1, result: 'kein Hinweis auf Schmerzen', level: 'ok' },
            { min: 2, max: 5, result: 'Schmerzen wahrscheinlich – Ursache abklären, Schmerztherapie prüfen', level: 'warn' },
            { min: 6, max: 10, result: 'starke Schmerzen wahrscheinlich', level: 'crit' },
          ],
        },
      },
    })
    await client.assessment.create({ data: { residentId: residentIds['202'], key: 'besd', score: 1, result: 'kein Hinweis auf Schmerzen', answers: { q1: 0, q2: 1, q3: 0, q4: 0, q5: 0 }, authorId: U.DS, at: at(addDays(today, -7), '15:00'), nextDue: addDays(today, 0) } })

    // Evaluationen der Pflegeplanung: Ernährung Frau Frei heute fällig, Mobilität Frau Brunner seit 2 Tagen überfällig
    for (const [room, domain, due] of [['205', 'nutrition', today], ['201', 'mobility', addDays(today, -2)]] as const) {
      await client.carePlanArea.updateMany({ where: { domain, carePlan: { residentId: residentIds[room], status: 'active' } }, data: { evaluateBy: due } })
      await client.carePlan.updateMany({ where: { residentId: residentIds[room], status: 'active' }, data: { nextEvaluation: due } })
    }

    // Ereignis-Massnahme «Hausarzt informieren» der zuständigen Fachperson zugewiesen (auch in der Aufgabe)
    const call = await client.incidentAction.findFirst({ where: { incidentId: fall.id, title: 'Hausarzt informieren' } })
    if (call) {
      await client.incidentAction.update({ where: { id: call.id }, data: { assigneeId: U.DS } })
      if (call.taskId) await client.task.update({ where: { id: call.taskId }, data: { assigneeId: U.DS } })
    }
  }

  // Übergabe der letzten Schicht
  const ho = await client.handover.create({ data: { unitId: wg2.id, shiftCode: 'F', date: dbDate(today), authorId: U.LR, submittedAt: minsAgo(30) } })
  await client.handoverEntry.create({ data: { handoverId: ho.id, residentId: residentIds['203'], watch: 'Atmung und Temperatur engmaschig, Reserve Morphin bei Atemnot', open: 'Lagerung 17:00', important: true, authorId: U.DS } })
  await client.handoverEntry.create({ data: { handoverId: ho.id, residentId: residentIds['207'], watch: 'Nach Sturz: Schmerzen Hüfte beobachten, Bettalarm aktiv', open: 'Sturzassessment ausstehend', important: true, authorId: U.MK } })
  await client.handoverEntry.create({ data: { handoverId: ho.id, residentId: residentIds['201'], watch: 'BZ morgen nüchtern', authorId: U.LR } })

  // Arztvisite heute (PRD §29): Termine und von der Pflege vorgemerkte Fragen mit Bezug auf Vitalwert bzw. Verlaufseintrag
  for (const [room, time] of [['201', '10:30'], ['204', '10:45'], ['206', '11:00']] as const) {
    await client.appointment.create({ data: { residentId: residentIds[room], at: at(today, time), title: 'Arztvisite Dr. med. P. Keller', kind: 'physician', createdById: U.BG } })
  }
  const dm2 = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const bz = await client.vitalSign.findFirst({ where: { residentId: residentIds['201'], glucose: { gt: 10 } }, orderBy: { at: 'desc' } })
  const bd = await client.observation.findFirst({ where: { residentId: residentIds['204'], text: { startsWith: 'BD 162/94' } } })
  const hypo1 = await client.observation.findFirst({ where: { residentId: residentIds['206'], text: { startsWith: 'BZ 3,9' } } })
  const questions = [
    { room: '201', by: 'DS', ago: 200, text: 'BZ wiederholt über 10 mmol/l, heute 11,8 mmol/l. Diabetestherapie anpassen?', ref: bz ? { refType: 'vital', refId: bz.id, refLabel: `Blutzucker 11,8 mmol/l ▲ · ${dm2(bz.at)}` } : null },
    { room: '204', by: 'LR', ago: 140, text: 'Blutdruck seit gestern erhöht, in Ruhe 154/90 mmHg. Antihypertensive Therapie anpassen?', ref: bd ? { refType: 'observation', refId: bd.id, refLabel: `Beobachtung · ${dm2(bd.at)} · BD 162/94 mmHg nach Spaziergang, nach 15 Min. Ruhe 154/90.` } : null },
    { room: '206', by: 'DS', ago: 290, text: 'Hypoglykämie 3,9 mmol/l am Nachmittag. Insulindosis am Mittag prüfen?', ref: hypo1 ? { refType: 'observation', refId: hypo1.id, refLabel: `Beobachtung · ${dm2(hypo1.at)} · BZ 3,9 mmol/l um 16 Uhr, leicht schwitzig.` } : null },
  ]
  for (const q of questions) {
    await client.visitQuestion.create({ data: { orgId: org.id, residentId: residentIds[q.room], text: q.text, ...(q.ref ?? {}), createdById: U[q.by], createdAt: minsAgo(q.ago) } })
  }

  // Bewohnerzuordnung (PRD §7, §70): laufende Schicht der Wohngruppe 2 und dieselbe Schicht am Vortag (Grundlage des Vorschlags)
  {
    const code = nowMin >= 1365 || nowMin < 420 ? 'N' : nowMin >= 885 ? 'S' : 'F'
    const current = code === 'N' && nowMin < 420 ? addDays(today, -1) : today
    const rooms = Object.keys(residentIds).filter((r) => r.startsWith('2')).sort()
    for (const day of [addDays(current, -1), current]) {
      const onDuty = (await client.shift.findMany({ where: { unitId: wg2.id, shiftTypeId: st[code], date: dbDate(day), userId: { not: null } }, select: { userId: true } })).map((s) => s.userId!)
      // Anna zuerst, damit «Meine Bewohnenden» in der Demo gefüllt ist
      const order = [...new Set([U.AM, ...Object.values(U)])].filter((u) => onDuty.includes(u))
      if (!order.length) continue
      const per = Math.ceil(rooms.length / order.length)
      await client.shiftAssignment.createMany({
        data: rooms.map((room, i) => ({ orgId: org.id, unitId: wg2.id, shiftCode: code, date: dbDate(day), residentId: residentIds[room], userId: order[Math.floor(i / per)], createdById: U.DS })),
      })
    }
  }

  // Kommunikation
  const ch: Record<string, string> = {}
  for (const c of [
    { key: 'company', name: 'Stiftung Lindenhof', kind: 'company' as const },
    { key: 'location', name: 'Haus Lindenhof', kind: 'location' as const, locationId: loc.id },
    { key: 'unit', name: 'Wohngruppe 2', kind: 'unit' as const, unitId: wg2.id },
    { key: 'care', name: 'Pflege', kind: 'care' as const },
    { key: 'admin', name: 'Administration', kind: 'admin' as const },
    { key: 'events', name: 'Events', kind: 'events' as const },
    { key: 'offers', name: 'Mitarbeiterangebote', kind: 'offers' as const },
  ]) {
    const { key, ...data } = c
    ch[key] = (await client.channel.create({ data: { orgId: org.id, ...data } })).id
  }
  const p1 = await client.post.create({ data: { channelId: ch.care, authorId: U.CW, title: 'Neue Weisung Hypoglykämie ab 1. des Monats', body: 'Die überarbeitete Weisung Hypoglykämie (Version 3.0) ist freigegeben. Wichtigste Änderung: Glukose-Gel ist neu erste Wahl, wenn die Person schlucken kann. Bitte lesen und bestätigen.', important: true, requireAck: true, pinned: true, publishedAt: minsAgo(60 * 26) } })
  await client.post.create({ data: { channelId: ch.unit, authorId: U.BG, title: 'Teamsitzung Donnerstag', body: 'Teamsitzung am Donnerstag 14:00 im Aufenthaltsraum. Traktanden: Sturzprophylaxe nachts, Ferienplanung Sommer.', publishedAt: minsAgo(60 * 50) } })
  await client.post.create({ data: { channelId: ch.events, authorId: U.HR, title: 'Herbstfest für Bewohnende und Angehörige', body: 'Am Samstag in drei Wochen findet das Herbstfest statt. Helferinnen und Helfer bitte bei der Stationsleitung melden.', eventAt: at(addDays(today, 19), '14:00'), eventPlace: 'Garten Haus Lindenhof', publishedAt: minsAgo(60 * 80) } })
  await client.post.create({ data: { channelId: ch.offers, authorId: U.HR, title: 'Vergünstigte Velo-Abos', body: 'Mitarbeitende erhalten 20 % auf das Jahresabo bei VeloZürich. Code im HR-Portal.', publishedAt: minsAgo(60 * 120) } })
  await client.post.create({ data: { channelId: ch.company, authorId: U.CW, title: 'Lohnrunde und neue Zulagen Nachtdienst', body: 'Ab Januar steigt die Nachtdienstzulage auf CHF 8.– pro Stunde. Details im HR-Dokument "Zulagenreglement".', important: true, requireAck: true, publishedAt: minsAgo(60 * 30) } })
  for (const k of ['LR', 'DS', 'BG', 'TN', 'SB', 'NM', 'CW', 'QM']) await client.acknowledgement.create({ data: { userId: U[k], subjectType: 'post', subjectId: p1.id } })
  // Zielgruppe (PRD §45): nur Pflegefachpersonen und Fachverantwortung
  await client.post.create({ data: { channelId: ch.care, authorId: U.BG, title: 'Praxisanleitung Lernende: neue Checkliste', body: 'Für die Begleitung der Lernenden gilt ab sofort die neue Checkliste Praxisanleitung. Bitte vor dem nächsten Qualifikationsgespräch durchsehen.', requireAck: true, audienceRoles: ['nurse', 'specialist'], publishedAt: minsAgo(60 * 20) } })

  const dm = await client.conversation.create({ data: { orgId: org.id, kind: 'direct', createdById: U.LR, lastMessageAt: minsAgo(25) } })
  await client.conversationMember.createMany({ data: [{ conversationId: dm.id, userId: U.AM, lastReadAt: minsAgo(400) }, { conversationId: dm.id, userId: U.LR, lastReadAt: minsAgo(25) }] })
  await client.message.create({ data: { conversationId: dm.id, authorId: U.LR, body: 'Hoi Anna, kannst du am Samstag meinen Spätdienst übernehmen? Ich würde dafür den Frühdienst am Dienstag nehmen.', createdAt: minsAgo(25) } })
  const grp = await client.conversation.create({ data: { orgId: org.id, kind: 'team', name: 'Team WG 2', createdById: U.BG, lastMessageAt: minsAgo(90) } })
  await client.conversationMember.createMany({ data: ['AM', 'LR', 'MK', 'DS', 'BG', 'TN', 'SB', 'JF'].map((k) => ({ conversationId: grp.id, userId: U[k], lastReadAt: k === 'AM' ? minsAgo(500) : minsAgo(80) })) })
  await client.message.create({ data: { conversationId: grp.id, authorId: U.BG, body: 'Die neuen Inkontinenzmaterialien sind im Lager eingetroffen, alte Bestände bitte zuerst aufbrauchen.', createdAt: minsAgo(240) } })
  await client.message.create({ data: { conversationId: grp.id, authorId: U.DS, body: '@Anna Muster bitte bei Frau Huber heute Abend die Mundpflege mit dem neuen Gel probieren, Rückmeldung in den Verlauf.', mentions: [U.AM], createdAt: minsAgo(90) } })

  // Dokumente
  const doc = async (title: string, category: string, tags: string[], versions: { v: string; body: string; note?: string; critical?: boolean; days: number }[], requireAck = false) => {
    const d = await client.document.create({ data: { orgId: org.id, title, category, tags, status: 'approved', ownerId: U.CW, requireAck, validFrom: addDays(today, -versions[versions.length - 1].days), validUntil: addDays(today, 365), currentVersion: versions[versions.length - 1].v } })
    for (const v of versions) await client.documentVersion.create({ data: { documentId: d.id, version: v.v, body: v.body, changeNote: v.note, critical: !!v.critical, authorId: U.DS, approvedById: U.CW, approvedAt: addDays(today, -v.days), createdAt: addDays(today, -v.days - 2) } })
    return d
  }
  const hypo = await doc('Weisung Hypoglykämie', 'instruction', ['hypoglykämie', 'diabetes', 'blutzucker', 'notfall'], [
    { v: '2.1', days: 400, body: '## Ziel\nRasche und sichere Behandlung einer Unterzuckerung.\n\n## Vorgehen\n1. BZ messen.\n2. Bei BZ < 4 mmol/l und erhaltenem Schluckreflex: 2 dl Orangensaft.\n3. Nach 15 Minuten erneut messen.' },
    { v: '3.0', days: 2, critical: true, note: 'Glukose-Gel als erste Wahl, Glucagon-Schema ergänzt', body: '## Ziel\nRasche und sichere Behandlung einer Unterzuckerung (BZ < 4 mmol/l).\n\n## Vorgehen\n1. BZ messen und dokumentieren.\n2. **Person kann schlucken:** 1 Tube Glukose-Gel 40 % oder 2 dl Orangensaft.\n3. Nach 15 Minuten erneut messen. Bei BZ < 4 mmol/l Schritt 2 wiederholen.\n4. **Person kann nicht schlucken / bewusstlos:** Seitenlage, Glucagon 1 mg s.c. gemäss Verordnung, Notruf 144, Hausarzt informieren.\n\n## Dokumentation\nVerlaufseintrag Kategorie Beobachtung, Ereignis bei Bewusstlosigkeit.\n\n> Insulindosis nie eigenständig ändern – Rücksprache Hausarzt.' },
  ], true)
  void hypo
  const woundDoc = await doc('Wundstandard Dekubitus', 'guideline', ['wunde', 'dekubitus', 'wundstandard', 'braden'], [{ v: '1.4', days: 120, body: '## Einschätzung\nBraden-Skala bei Eintritt und alle 7 Tage, bei Veränderung sofort.\n\n## Kategorien\n- Kategorie 1: nicht wegdrückbare Rötung\n- Kategorie 2: Teilverlust der Haut\n- Kategorie 3: Verlust der Haut\n- Kategorie 4: vollständiger Gewebeverlust\n\n## Massnahmen\nDruckentlastung, Lagerung 30°, Hautpflege, Ernährung prüfen. Fotodokumentation nur über CareOS Wunden.' }])
  await doc('Sturzprotokoll und Nachsorge', 'form', ['sturz', 'sturzprotokoll', 'ereignis'], [{ v: '2.0', days: 300, body: '## Sofort\n- Person nicht sofort aufrichten, Verletzungen prüfen\n- Vitalzeichen, Bewusstsein, Schmerzen\n\n## Innerhalb von 24 h\n- Ereignis in CareOS Qualität melden\n- Sturzassessment\n- Hausarzt gemäss Standard informieren\n- Pflegeplanung prüfen' }])
  await doc('Händehygiene', 'hygiene', ['hygiene', 'händedesinfektion'], [{ v: '5.0', days: 200, body: '## 5 Momente der Händehygiene\n1. Vor Patientenkontakt\n2. Vor aseptischen Tätigkeiten\n3. Nach Kontakt mit Körperflüssigkeiten\n4. Nach Patientenkontakt\n5. Nach Kontakt mit der Patientenumgebung' }])
  await doc('Notfallprozess Reanimation', 'emergency', ['notfall', 'reanimation', 'rea'], [{ v: '1.2', days: 500, body: '## Ablauf\n1. REA-Status in der Akte prüfen (Banner)\n2. Hilfe holen, Notruf 144\n3. Bei REA ja: Herzdruckmassage 30:2, AED holen lassen' }])
  await doc('Zulagenreglement', 'hr', ['zulagen', 'nachtdienst', 'lohn'], [{ v: '2026.1', days: 30, body: '## Nachtdienstzulage\nCHF 8.– pro Stunde zwischen 23:00 und 06:00.\n\n## Wochenendzulage\nCHF 5.– pro Stunde.' }])
  await doc('Checkliste Eintritt', 'checklist', ['eintritt', 'aufnahme'], [{ v: '1.0', days: 90, body: '- Stammdaten erfasst\n- Medikamentenplan übernommen und doppelt kontrolliert\n- Assessments Braden, Sturz, MNA innert 72 h\n- Angehörige und Notfallkontakt erfasst' }])
  await client.acknowledgement.createMany({ data: ['LR', 'DS', 'BG'].map((k) => ({ userId: U[k], subjectType: 'document', subjectId: hypo.id, version: '3.0' })) })
  // Wundstandard: Zielgruppe Pflege, Gültigkeit endet bald (Erinnerung an die verantwortliche Person)
  await client.document.update({ where: { id: woundDoc.id }, data: { validUntil: addDays(today, 20), audienceRoles: ['nurse', 'specialist', 'ward_lead', 'nursing_director'] } })

  // Schulungen
  const CARE_ROLES = ['care_assistant', 'nurse', 'specialist', 'ward_lead', 'nursing_director']
  const course = async (title: string, category: string, mandatory: boolean, validity: number | null, minutes: number, modules: { kind: string; title: string; body?: string; quiz?: unknown }[]) => {
    const c = await client.course.create({ data: { orgId: org.id, title, category, mandatory, validityMonths: validity, estMinutes: minutes, description: modules[0]?.body?.slice(0, 160), audienceRoles: mandatory ? CARE_ROLES : [] } })
    for (const [i, m] of modules.entries()) await client.courseModule.create({ data: { courseId: c.id, order: i, kind: m.kind, title: m.title, body: m.body, quiz: m.quiz as Prisma.InputJsonValue } })
    return c
  }
  const hyg = await course('Pflichtschulung Hygiene', 'hygiene', true, 12, 25, [
    { kind: 'text', title: 'Grundlagen', body: 'Händehygiene ist die wirksamste Einzelmassnahme gegen Infektionen. Diese Schulung frischt die 5 Momente auf.' },
    { kind: 'quiz', title: 'Wissensprüfung', quiz: { pass: 0.8, questions: [
      { q: 'Wie lange dauert eine Händedesinfektion mindestens?', options: ['10 Sekunden', '30 Sekunden', '2 Minuten'], answer: 1 },
      { q: 'Wann ist Händedesinfektion nötig?', options: ['Nur nach Kontakt', 'Vor und nach Kontakt', 'Nur bei sichtbarer Verschmutzung'], answer: 1 },
      { q: 'Dürfen Ringe während der Pflege getragen werden?', options: ['Ja', 'Nein', 'Nur Eheringe'], answer: 1 },
    ] } },
  ])
  const fire = await course('Brandschutz', 'safety', true, 24, 20, [{ kind: 'text', title: 'Verhalten im Brandfall', body: 'Alarmieren, Retten, Löschen. Fluchtwege kennen, Brandschutztüren nie verkeilen.' }, { kind: 'practical', title: 'Praktische Übung Feuerlöscher', body: 'Wird durch die Sicherheitsbeauftragte bestätigt.' }])
  const med = await course('Medikamentensicherheit', 'clinical', false, null, 40, [{ kind: 'text', title: '6-R-Regel', body: 'Richtige Person, richtiges Medikament, richtige Dosis, richtige Applikation, richtiger Zeitpunkt, richtige Dokumentation.' }, { kind: 'quiz', title: 'Fallbeispiele', quiz: { pass: 0.75, questions: [{ q: 'Eine Bewohnerin verweigert die Tablette. Was tun?', options: ['In Joghurt verstecken', 'Verweigerung dokumentieren und später erneut anbieten', 'Weglassen ohne Dokumentation'], answer: 1 }] } }])
  await course('Kinästhetik Grundkurs', 'clinical', false, null, 90, [{ kind: 'text', title: 'Bewegungsunterstützung', body: 'Kinästhetik fördert die Eigenbewegung und schont den Rücken der Pflegenden.' }])
  for (const k of ['AM', 'LR', 'MK', 'DS', 'TN', 'SB', 'JF', 'NM', 'BG']) {
    const doneHyg = !['AM', 'JF'].includes(k)
    await client.enrollment.create({ data: { courseId: hyg.id, userId: U[k], status: doneHyg ? 'completed' : 'assigned', dueAt: addDays(today, k === 'JF' ? -4 : 12), completedAt: doneHyg ? addDays(today, -100) : null, score: doneHyg ? 1 : null, doneModules: doneHyg ? ['0', '1'] : [] } })
    if (doneHyg) await client.certificate.create({ data: { userId: U[k], courseId: hyg.id, title: 'Pflichtschulung Hygiene', issuedAt: addDays(today, -100), expiresAt: addDays(today, 265) } })
    await client.enrollment.create({ data: { courseId: fire.id, userId: U[k], status: k === 'MK' ? 'assigned' : 'completed', dueAt: addDays(today, 30), completedAt: k === 'MK' ? null : addDays(today, -650), doneModules: k === 'MK' ? [] : ['0', '1'] } })
    if (k !== 'MK') await client.certificate.create({ data: { userId: U[k], courseId: fire.id, title: 'Brandschutz', issuedAt: addDays(today, -650), expiresAt: addDays(today, 80) } })
  }
  await client.enrollment.create({ data: { courseId: med.id, userId: U.AM, status: 'in_progress', doneModules: ['0'], dueAt: addDays(today, 21) } })

  // Benachrichtigungen für Anna
  await client.notification.createMany({ data: [
    { userId: U.AM, priority: 'critical', kind: 'vitals', title: 'Huber Margrit: SpO₂ 89 %, Temp. 38,1 °C', body: 'Werte ausserhalb Referenz', href: `/residents/${residentIds['203']}/vitals`, createdAt: minsAgo(35) },
    { userId: U.AM, priority: 'action', kind: 'ack', title: 'Weisung Hypoglykämie 3.0 bestätigen', href: '/docs', createdAt: minsAgo(60 * 26) },
    { userId: U.AM, priority: 'action', kind: 'learn', title: 'Pflichtschulung Hygiene offen', body: 'Fällig in 12 Tagen', href: '/learn', createdAt: minsAgo(60 * 30) },
    { userId: U.AM, priority: 'social', kind: 'chat', title: 'Lea Rohner: Schichttausch Samstag?', href: '/chat', createdAt: minsAgo(25) },
    { userId: U.AM, priority: 'info', kind: 'post', title: 'Neu im Kanal Wohngruppe 2: Teamsitzung Donnerstag', href: '/team', createdAt: minsAgo(60 * 50) },
  ] })

  await client.featureFlag.createMany({ data: [{ orgId: org.id, key: 'ai', enabled: true }, { orgId: org.id, key: 'voice', enabled: true }, { orgId: org.id, key: 'medication', enabled: true }] })

  console.log('Demodaten angelegt. Login: anna.muster@lindenhof.ch / careos-demo')
  return true
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedDemo()
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
    .finally(() => db.$disconnect())
}
