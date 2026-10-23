/**
 * Demodaten Spitex (nur mit SEED_DEMO, aus prisma/seed.ts): Einsatzgebiet «Spitex Zürich Nord» mit drei Mitarbeitenden,
 * sieben Klient/innen (erfundene Adressen), Wochenvorlagen und Einsätzen – abgeschlossene seit Monatsbeginn für den
 * Leistungsnachweis, heute teils erledigt, offen, ein nicht zugewiesener und ein Konflikt mit einem Stationsdienst.
 * Zugänge (Türcode) werden beim ersten Abruf in der App verschlüsselt (src/app/(app)/spitex/actions.ts).
 */
import type { PrismaClient } from '@prisma/client'
import { appendSequences, parseServices, visitsForDay, type TemplateLike } from '../src/lib/spitex'

type Ctx = {
  orgId: string
  roles: Record<string, string>
  pw: string
  today: Date
  now: Date
  /** Stationsbereich für den Konfliktfall (Stationsdienst am selben Tag) */
  wardUnitId: string
  lateShiftTypeId: string
  rng: () => number
}

const dbDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)

export async function seedSpitexDemo(client: PrismaClient, c: Ctx) {
  await client.organization.update({ where: { id: c.orgId }, data: { modules: { push: 'spitex' } } })
  const loc = await client.location.create({ data: { orgId: c.orgId, name: 'Spitex Lindenhof', address: 'Wehntalerstrasse 300, 8046 Zürich', phone: '044 000 00 50' } })
  const unit = await client.unit.create({ data: { orgId: c.orgId, locationId: loc.id, name: 'Spitex Zürich Nord', shortName: 'SPX', kind: 'homecare' } })
  await client.channel.create({ data: { orgId: c.orgId, name: unit.name, kind: 'unit', unitId: unit.id } })

  const staff = [
    { key: 'SF', first: 'Sarah', last: 'Frei', title: 'Pflegefachperson HF', role: 'nurse' },
    { key: 'MR', first: 'Marco', last: 'Rossi', title: 'FaGe', role: 'nurse' },
    { key: 'EB', first: 'Elif', last: 'Bajrami', title: 'Pflegehelferin SRK', role: 'care_assistant' },
  ]
  const U: Record<string, string> = {}
  for (const s of staff) {
    const u = await client.user.create({
      data: {
        orgId: c.orgId, email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}@lindenhof.ch`, firstName: s.first, lastName: s.last, initials: s.key,
        jobTitle: s.title, passwordHash: c.pw, primaryUnitId: unit.id, theme: 'light', locale: 'de', workPhone: '044 000 00 5' + (Object.keys(U).length + 1),
      },
    })
    U[s.key] = u.id
    await client.roleAssignment.create({ data: { userId: u.id, roleId: c.roles[s.role], unitId: unit.id } })
  }
  // Elif hilft heute im Spätdienst auf der Wohngruppe aus → Konflikthinweis beim Abendeinsatz
  await client.shift.create({ data: { unitId: c.wardUnitId, userId: U.EB, shiftTypeId: c.lateShiftTypeId, date: dbDate(c.today) } })

  type S = { klv: 'a' | 'b' | 'c'; label: string; minutes: number }
  const hyg: S = { klv: 'c', label: 'Körperpflege', minutes: 30 }
  const med: S = { klv: 'b', label: 'Medikamente richten und abgeben', minutes: 10 }
  const comp: S = { klv: 'c', label: 'Kompressionsstrümpfe anziehen', minutes: 10 }
  const vit: S = { klv: 'b', label: 'Vitalzeichen kontrollieren', minutes: 10 }
  const ins: S = { klv: 'b', label: 'Injektion (Insulin)', minutes: 10 }
  const wound: S = { klv: 'b', label: 'Wundversorgung Unterschenkel', minutes: 25 }
  const shower: S = { klv: 'c', label: 'Duschen', minutes: 40 }
  const advice: S = { klv: 'a', label: 'Beratung Angehörige', minutes: 15 }
  const ALL = [1, 2, 3, 4, 5, 6, 0]
  const clients: {
    first: string; last: string; born: string; sex: string; street: string; zip: string; city: string; phone: string; access: string | null; allergies?: string[]
    tpl: { days: number[]; start: string; end: string; services: S[]; pref: string | null }[]
  }[] = [
    { first: 'Hedwig', last: 'Baumann', born: '1936-02-11', sex: 'f', street: 'Hofwiesenstrasse 18', zip: '8057', city: 'Zürich', phone: '044 300 11 21', access: 'Schlüsselbox links neben der Tür, Code 4711. Klingel defekt – kurz anrufen.',
      tpl: [{ days: ALL, start: '07:30', end: '08:15', services: [hyg, med], pref: 'SF' }, { days: [1, 4], start: '16:00', end: '16:40', services: [shower], pref: 'EB' }] },
    { first: 'Ernst', last: 'Wyss', born: '1941-08-30', sex: 'm', street: 'Schaffhauserstrasse 355', zip: '8050', city: 'Zürich', phone: '044 300 11 22', access: 'Haustür offen, Wohnung 3. OG rechts. Schlüssel beim Nachbarn Meier.', allergies: ['Pflaster (Latex)'],
      tpl: [{ days: ALL, start: '08:20', end: '08:50', services: [ins, vit], pref: 'SF' }, { days: ALL, start: '17:30', end: '17:45', services: [ins], pref: 'EB' }] },
    { first: 'Margrit', last: 'Studer', born: '1933-05-04', sex: 'f', street: 'Birchstrasse 120', zip: '8050', city: 'Zürich', phone: '044 300 11 23', access: 'Türcode 2580#',
      tpl: [{ days: [1, 3, 5], start: '09:00', end: '09:40', services: [wound, comp], pref: 'SF' }, { days: ALL, start: '07:45', end: '08:00', services: [comp], pref: 'MR' }] },
    { first: 'Walter', last: 'Keller', born: '1938-12-19', sex: 'm', street: 'Regensbergstrasse 210', zip: '8050', city: 'Zürich', phone: '044 300 11 24', access: null,
      tpl: [{ days: ALL, start: '08:10', end: '08:55', services: [hyg, comp], pref: 'MR' }] },
    { first: 'Rosa', last: 'Imhof', born: '1945-03-07', sex: 'f', street: 'Wehntalerstrasse 520', zip: '8046', city: 'Zürich', phone: '044 300 11 25', access: 'Schlüssel im Tresor Stützpunkt, Nr. 12.',
      tpl: [{ days: [2, 5], start: '10:00', end: '10:45', services: [shower, vit], pref: 'MR' }, { days: [1], start: '14:00', end: '14:45', services: [advice, vit], pref: 'SF' }] },
    { first: 'Anton', last: 'Brunner', born: '1930-10-25', sex: 'm', street: 'Oerlikonerstrasse 47', zip: '8057', city: 'Zürich', phone: '044 300 11 26', access: 'Ehefrau öffnet. Hund ist freundlich.',
      tpl: [{ days: ALL, start: '09:10', end: '09:40', services: [hyg], pref: 'MR' }, { days: ALL, start: '18:00', end: '18:20', services: [med, comp], pref: 'EB' }] },
    { first: 'Lina', last: 'Gasser', born: '1948-06-14', sex: 'f', street: 'Affolternstrasse 86', zip: '8050', city: 'Zürich', phone: '044 300 11 27', access: null,
      // ohne bevorzugte Person: erscheint in der Disposition als «nicht zugewiesen»
      tpl: [{ days: ALL, start: '11:00', end: '11:30', services: [vit, med], pref: null }] },
  ]

  const monthStart = new Date(c.today.getFullYear(), c.today.getMonth(), 1)
  // Leistungsnachweis: mindestens 14 Tage zurück, sonst seit Monatsbeginn
  const from = monthStart < addDays(c.today, -14) ? monthStart : addDays(c.today, -14)
  const templates: (TemplateLike & { createdById: string })[] = []
  const residents: string[] = []
  for (const [i, k] of clients.entries()) {
    const r = await client.resident.create({
      data: {
        orgId: c.orgId, unitId: unit.id, firstName: k.first, lastName: k.last, birthDate: new Date(k.born + 'T00:00:00Z'), sex: k.sex, rea: i % 3 === 0 ? 'no' : 'yes',
        allergies: k.allergies ?? [], street: k.street, postalCode: k.zip, city: k.city, phone: k.phone, accessNote: k.access,
        insuranceNo: `756.${4000 + i * 137}.${1000 + i * 71}.${10 + i}`, admittedAt: addDays(from, -90 - i * 40), physician: 'Dr. med. P. Keller',
      },
    })
    residents.push(r.id)
    await client.careEpisode.create({ data: { residentId: r.id, start: r.admittedAt, reason: 'Spitex-Auftrag', kind: 'stay', unitId: unit.id } })
    for (const t of k.tpl) {
      const tpl = await client.homeCareTemplate.create({
        data: { orgId: c.orgId, residentId: r.id, weekdays: t.days, start: t.start, end: t.end, services: t.services, preferredUserId: t.pref ? U[t.pref] : null, startDate: dbDate(from), createdById: U.SF },
      })
      templates.push({ ...tpl, startDate: from, endDate: null, updatedAt: undefined, createdById: U.SF })
    }
  }

  // Einsätze seit Beginn des Zeitraums bis heute (heute vor «jetzt» erledigt, laufend der aktuelle, danach geplant)
  const active = new Set(residents)
  for (let d = new Date(from); d <= c.today; d = addDays(d, 1)) {
    const isToday = d.getTime() === c.today.getTime()
    // Vergangene offene Einsätze hat Sarah übernommen (vor der Reihenfolge, damit die Tourpositionen stimmen)
    const generated = visitsForDay(templates, d, { existing: new Set(), activeResidents: active }).map((r) => (r.assigneeId || r.plannedEnd > c.now ? r : { ...r, assigneeId: U.SF }))
    const rows = appendSequences([], generated)
    for (const row of rows) {
      const past = row.plannedEnd < c.now
      const running = isToday && row.plannedStart <= c.now && !past
      // Ein Einsatz heute wurde abgesagt (Klientin im Spital), ein vergangener nicht angetroffen
      const cancelled = isToday && row.residentId === residents[4] && row.plannedStart > c.now
      const missed = !isToday && c.rng() < 0.02
      const jitter = Math.round(c.rng() * 10) - 3
      const start = addMin(row.plannedStart, jitter)
      const dur = (row.plannedEnd.getTime() - row.plannedStart.getTime()) / 60_000
      const end = addMin(start, Math.max(10, Math.round(dur + c.rng() * 8 - 4)))
      const status = cancelled ? 'cancelled' : missed && past ? 'missed' : past ? 'done' : running ? 'started' : 'planned'
      const by = row.assigneeId ?? U.SF
      await client.homeCareVisit.create({
        data: {
          orgId: c.orgId, unitId: unit.id, residentId: row.residentId, templateId: row.templateId, date: dbDate(d), plannedStart: row.plannedStart, plannedEnd: row.plannedEnd,
          assigneeId: row.assigneeId, sequence: row.sequence, status, createdById: U.SF,
          actualStart: status === 'done' || status === 'started' ? start : null, actualEnd: status === 'done' ? end : status === 'missed' ? start : null,
          startedById: status === 'done' || status === 'started' ? by : null, doneById: status === 'done' || status === 'missed' ? by : null,
          note: status === 'missed' ? 'Niemand öffnet, Telefon ohne Antwort. Angehörige informiert.' : null,
          services: {
            create: parseServices(row.services).map((s, i) => {
              const done = status === 'done' && !(i > 0 && c.rng() < 0.05)
              return { klv: s.klv, label: s.label, plannedMin: s.minutes, order: i, done, actualMin: done ? Math.max(1, s.minutes + Math.round(c.rng() * 6 - 2)) : null }
            }),
          },
        },
      })
    }
  }
  // Ein zusätzlicher, einzeln geplanter Einsatz heute (Nachkontrolle nach Spitalaustritt), noch nicht zugewiesen
  const slot = 15 * 60_000
  const extraStart = new Date(Math.ceil(Math.max(c.now.getTime() + 90 * 60_000, new Date(c.today.getFullYear(), c.today.getMonth(), c.today.getDate(), 15, 0).getTime()) / slot) * slot)
  if (extraStart.getDate() === c.today.getDate()) {
    await client.homeCareVisit.create({
      data: {
        orgId: c.orgId, unitId: unit.id, residentId: residents[3], date: dbDate(c.today), plannedStart: extraStart, plannedEnd: addMin(extraStart, 30), sequence: 99, createdById: U.SF,
        note: 'Nachkontrolle nach Spitalaustritt', services: { create: [{ klv: 'a', label: 'Bedarfsabklärung', plannedMin: 20, order: 0 }, { klv: 'b', label: 'Vitalzeichen kontrollieren', plannedMin: 10, order: 1 }] },
      },
    })
  }
  return { unitId: unit.id, users: U }
}
