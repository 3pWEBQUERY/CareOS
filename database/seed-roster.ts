// Demo-Daten für das Dienstplan-Modul (Spec Abschnitt 13). Nur für Entwicklung und Demo:
// bricht bei NODE_ENV=production ohne --allow-production ab. Idempotent (feste IDs, ON CONFLICT),
// relativ zum aktuellen Monat: Vormonat abgeschlossen mit Zeiteinträgen, aktueller Monat
// veröffentlicht, Folgemonat als Entwurf. Ausschliesslich erfundene Namen.
//
// Usage: npm run db:seed:roster
import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";
import "./pg-fetch.mjs";
import { addDays, localDate, monthDays, plannedInterval, shiftMonth, weekday } from "../lib/roster/time";
import { DEFAULT_QUALIFICATIONS, DEFAULT_SHIFT_TYPES } from "../lib/roster/defaults";
import { publicHolidays } from "../lib/holidays";

if (process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
  console.error("Der Dienstplan-Seed ist nur für Entwicklung und Demo gedacht (NODE_ENV=production).");
  process.exit(1);
}
const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
const sql = neon(connectionString);
const scrypt = promisify(scryptCallback);

const TZ = "Europe/Zurich";
const DEMO_PASSWORD = process.env.ROSTER_DEMO_PASSWORD ?? "Dienstplan-Demo-2026";
const id = (key: string) => {
  const value = createHash("sha256").update(`carecore-roster-v1:${key}`).digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
// Deterministic "random" number 0..n-1 per key.
const pick = (key: string, n: number) => parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) % n;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}

const org = "00000000-0000-4000-8000-000000000101";
const site = "00000000-0000-4000-8000-000000000102";
const now = new Date();
const today = localDate(now, TZ);
const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
const previous = shiftMonth(current.year, current.month, -1);
const next = shiftMonth(current.year, current.month, 1);
// In den letzten zwei Wochen des Monats ist auch der Folgemonat veröffentlicht (wie im Betrieb); Entwurf ist dann der
// übernächste. So gibt es immer genug veröffentlichte künftige Dienste, etwa für Tausch-Anfragen.
const lateInMonth = monthDays(current.year, current.month).at(-1)! < addDays(today, 14);
const draft = lateInMonth ? shiftMonth(next.year, next.month, 1) : next;

type Person = {
  key: string;
  id: string;
  username: string;
  name: string;
  role: "leitung" | "pflege";
  unitKeys: string[];
  lead: boolean;
  pensum: number;
  qualification: "HF" | "FAGE" | "SRK" | null;
  excluded: string[];
};

const UNITS = [
  { key: "linde", name: "Wohngruppe Linde", floor: "EG" },
  { key: "ahorn", name: "Wohngruppe Ahorn", floor: "1. OG" },
  { key: "birke", name: "Wohngruppe Birke", floor: "2. OG" },
];

const NAMES: Record<string, string[]> = {
  linde: [
    "Nora Lindgren",
    "Aline Studer",
    "Jonas Frei",
    "Mira Baumann",
    "Luca Wenger",
    "Selina Graf",
    "Tim Egli",
    "Yara Kunz",
    "Ramon Vogt",
    "Elif Aebi",
  ],
  ahorn: [
    "Paul Ahrens",
    "Sina Moser",
    "David Hug",
    "Lena Bucher",
    "Noah Keller",
    "Julia Roth",
    "Samuel Hess",
    "Carla Frey",
    "Dario Suter",
  ],
  birke: [
    "Beatrice Imhof",
    "Fabian Steiner",
    "Olivia Brunner",
    "Nils Zürcher",
    "Anja Schmid",
    "Cedric Lüthi",
    "Maja Wyss",
    "Jan Meyer",
    "Laura Rüegg",
    "Kevin Gerber",
    "Tamara Bühler",
  ],
};

const people: Person[] = [];
for (const unit of UNITS) {
  const [leadName, ...staff] = NAMES[unit.key];
  const username = (name: string) =>
    `demo.${unit.key}.${name
      .split(" ")[0]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z]/g, "")}`;
  people.push({
    key: `${unit.key}:lead`,
    id: id(`person:${unit.key}:lead`),
    username: `demo.leitung.${unit.key}`,
    name: leadName,
    role: "leitung",
    unitKeys: [unit.key],
    lead: true,
    pensum: 100,
    qualification: "HF",
    excluded: [],
  });
  staff.forEach((name, index) =>
    people.push({
      key: `${unit.key}:${index}`,
      id: id(`person:${unit.key}:${index}`),
      username: username(name),
      name,
      role: "pflege",
      unitKeys: [unit.key],
      lead: false,
      pensum: [100, 80, 100, 60, 100, 90, 100, 80, 100, 70][index % 10],
      qualification: (["HF", "FAGE", "FAGE", "SRK", "HF", "FAGE", "SRK", "FAGE", "HF", "SRK"] as const)[index % 10],
      excluded: index === 3 ? ["NIGHT"] : [],
    }),
  );
}
// Springer: arbeitet in Linde und Ahorn.
people.push({
  key: "springer",
  id: id("person:springer"),
  username: "demo.springer",
  name: "Robin Flückiger",
  role: "pflege",
  unitKeys: ["linde", "ahorn"],
  lead: false,
  pensum: 100,
  qualification: "FAGE",
  excluded: [],
});

// 14-Tage-Rhythmus, der Ruhezeit und Folgetage einhält (Spät → Früh kommt nicht vor).
const ROTATION = ["F", "F", "S", "S", "N", "N", "-", "-", "Z", "F", "S", "-", "-", "-"];

async function main() {
  await sql`INSERT INTO carecore_organizations (id, name, timezone) VALUES (${org}, 'CareOS Demo', ${TZ}) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO carecore_sites (id, organization_id, name) VALUES (${site}, ${org}, 'Pflegezentrum Lindenhof') ON CONFLICT DO NOTHING`;
  const siteRow =
    await sql`SELECT id FROM carecore_sites WHERE organization_id = ${org} ORDER BY id = ${site} DESC LIMIT 1`;
  const siteId = String(siteRow[0].id);
  for (const unit of UNITS)
    await sql`INSERT INTO carecore_care_units (id, site_id, name, floor) VALUES (${id(`unit:${unit.key}`)}, ${siteId}, ${unit.name}, ${unit.floor})
      ON CONFLICT DO NOTHING`;
  const unitRows =
    await sql`SELECT id, name FROM carecore_care_units WHERE site_id = ${siteId} AND name = ANY(${UNITS.map((u) => u.name)})`;
  const unitId = Object.fromEntries(UNITS.map((u) => [u.key, String(unitRows.find((row) => row.name === u.name)!.id)]));

  // Grunddaten (wie Migration 0023 / ensureRosterDefaults).
  await sql`INSERT INTO carecore_rule_sets (organization_id, timezone) VALUES (${org}, ${TZ}) ON CONFLICT DO NOTHING`;
  for (const q of DEFAULT_QUALIFICATIONS)
    await sql`INSERT INTO carecore_qualifications (organization_id, code, name, grants_medication)
      VALUES (${org}, ${q.code}, ${q.name}, ${q.grantsMedication})
      ON CONFLICT (organization_id, code) DO NOTHING`;
  for (const t of DEFAULT_SHIFT_TYPES)
    await sql`INSERT INTO carecore_shift_types (organization_id, name, code, category, absence_kind, start_time, end_time,
        break_minutes, color, work_time_factor, credits_target, sort_order)
      VALUES (${org}, ${t.name}, ${t.code}, ${t.category}, ${t.absenceKind}, ${t.startTime}, ${t.endTime}, ${t.breakMinutes},
        ${t.color}, ${t.workTimeFactor}, ${t.creditsTarget}, ${t.sortOrder})
      ON CONFLICT (organization_id, code) DO NOTHING`;
  const typeRows =
    await sql`SELECT id, code, start_time, end_time, break_minutes FROM carecore_shift_types WHERE organization_id = ${org}`;
  const types = Object.fromEntries(typeRows.map((row) => [String(row.code), row]));
  const qualRows = await sql`SELECT id, code FROM carecore_qualifications WHERE organization_id = ${org}`;
  const qualification = Object.fromEntries(qualRows.map((row) => [String(row.code), String(row.id)]));

  // Personen, Profile, Mitgliedschaften, Qualifikationen.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const person of people) {
    await sql`INSERT INTO carecore_users (id, username, display_name, role, password_hash)
      VALUES (${person.id}, ${person.username}, ${person.name}, ${person.role}, ${passwordHash}) ON CONFLICT DO NOTHING`;
    // Personalprofil zuerst: der Trigger aus 0024 legt sonst beim Stammwohnbereich ein Standardprofil an.
    await sql`INSERT INTO carecore_employee_profiles (user_id, pensum_percent, excluded_categories)
      VALUES (${person.id}, ${person.pensum}, ${person.excluded}::text[]) ON CONFLICT (user_id) DO NOTHING`;
    await sql`INSERT INTO carecore_user_profiles (user_id, organization_id, job_title, primary_care_unit_id)
      VALUES (${person.id}, ${org}, ${person.lead ? "Teamleitung Pflege" : { HF: "Pflegefachperson HF", FAGE: "Fachperson Gesundheit", SRK: "Pflegehelfer:in SRK" }[person.qualification ?? "SRK"]},
        ${unitId[person.unitKeys[0]]}) ON CONFLICT (user_id) DO NOTHING`;
    for (const key of person.unitKeys)
      await sql`INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
        VALUES (${person.id}, ${unitId[key]}, ${!person.lead}, ${person.lead})
        ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = EXCLUDED.plannable, is_lead = EXCLUDED.is_lead`;
    if (person.qualification)
      await sql`INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from)
        VALUES (${person.id}, ${qualification[person.qualification]}, '2020-01-01') ON CONFLICT DO NOTHING`;
  }

  for (const year of [current.year, current.year + 1])
    for (const holiday of publicHolidays("CH", "ZH", year))
      await sql`INSERT INTO carecore_public_holidays (organization_id, date, name) VALUES (${org}, ${holiday.date}, ${holiday.name})
        ON CONFLICT (organization_id, date) DO NOTHING`;

  // Mindestbesetzung je Wohngruppe: Früh 2–4, Spät 2–3, Nacht 1 mit mindestens 1 Pflegefachperson HF.
  for (const unit of UNITS)
    for (let day = 1; day <= 7; day += 1)
      for (const [code, min, max, qualified] of [
        ["F", 2, 4, null],
        ["S", 2, 3, null],
        ["N", 1, 2, 1],
      ] as const)
        await sql`INSERT INTO carecore_staffing_requirements (id, care_unit_id, shift_type_id, weekday, min_count, max_count, min_qualified, qualification_id)
          VALUES (${id(`staff:${unit.key}:${code}:${day}`)}, ${unitId[unit.key]}, ${String(types[code].id)}, ${day}, ${min}, ${max},
            ${qualified}, ${qualified ? qualification.HF : null})
          ON CONFLICT DO NOTHING`;

  // Perioden: Vormonat abgeschlossen, aktueller Monat veröffentlicht, Folgemonat Entwurf (in den letzten zwei Wochen
  // des Monats veröffentlicht, dann ist der übernächste Monat der Entwurf).
  const periodId: Record<string, string> = {};
  const periods: Array<readonly [string, { year: number; month: number }, "PUBLISHED" | "DRAFT", boolean]> = [
    ["prev", previous, "PUBLISHED", true],
    ["current", current, "PUBLISHED", false],
    ["next", next, lateInMonth ? "PUBLISHED" : "DRAFT", false],
    ...(lateInMonth ? [["draft", draft, "DRAFT", false] as const] : []),
  ];
  for (const unit of UNITS)
    for (const [label, month, status, locked] of periods) {
      const key = `${unit.key}:${month.year}-${month.month}`;
      await sql`INSERT INTO carecore_schedule_periods (id, organization_id, care_unit_id, year, month, status, published_at, locked_at)
        VALUES (${id(`period:${key}`)}, ${org}, ${unitId[unit.key]}, ${month.year}, ${month.month}, ${status},
          ${status === "PUBLISHED" ? now.toISOString() : null}, ${locked ? now.toISOString() : null})
        ON CONFLICT (care_unit_id, year, month) DO NOTHING`;
      const row =
        await sql`SELECT id FROM carecore_schedule_periods WHERE care_unit_id = ${unitId[unit.key]} AND year = ${month.year} AND month = ${month.month}`;
      periodId[`${unit.key}:${label}`] = String(row[0].id);
    }

  // Dienste: Rotation je Person, Teilzeit lässt Tage aus, Abwesenheiten ersetzen Dienste.
  const days = [
    ...monthDays(previous.year, previous.month).map((date) => ["prev", date] as const),
    ...monthDays(current.year, current.month).map((date) => ["current", date] as const),
    ...monthDays(next.year, next.month)
      .slice(0, 14)
      .map((date) => ["next", date] as const),
  ];
  const vacationStart = addDays(`${today.slice(0, 7)}-01`, 14);
  type SeedShift = { id: string; person: Person; unitKey: string; date: string; code: string; label: string };
  const shifts: SeedShift[] = [];
  for (const person of people.filter((p) => !p.lead)) {
    const personIndex = people.indexOf(person);
    days.forEach(([label, date], dayIndex) => {
      const unitKey = person.unitKeys.length > 1 ? person.unitKeys[dayIndex % 14 < 7 ? 0 : 1] : person.unitKeys[0];
      const onVacation =
        person.key.endsWith(":2") && date >= vacationStart && date <= addDays(vacationStart, 4) && weekday(date) <= 5;
      const sick =
        person.key.endsWith(":5") && label === "prev" && Number(date.slice(8)) >= 10 && Number(date.slice(8)) <= 11;
      let code = ROTATION[(dayIndex + personIndex * 3) % ROTATION.length];
      if (code === "N" && person.excluded.includes("NIGHT")) code = "Z";
      if (code !== "-" && person.pensum < 100 && pick(`${person.key}:${date}`, 100) >= person.pensum) code = "-";
      if (onVacation) code = "U";
      if (sick) code = "K";
      if (code === "-") return;
      shifts.push({ id: id(`shift:${person.key}:${date}`), person, unitKey, date, code, label });
    });
  }
  // Remove rest-time conflicts created by skipped days or unit changes of the Springer.
  const byPerson = new Map<string, SeedShift[]>();
  for (const shift of shifts) byPerson.set(shift.person.id, [...(byPerson.get(shift.person.id) ?? []), shift]);
  const valid: SeedShift[] = [];
  for (const list of byPerson.values()) {
    let last: { end: number } | null = null;
    for (const shift of list.sort((a, b) => a.date.localeCompare(b.date))) {
      const t = types[shift.code];
      const { start, end } = plannedInterval(shift.date, String(t.start_time), String(t.end_time), TZ);
      if (shift.code !== "U" && shift.code !== "K" && last && start.getTime() - last.end < 11 * 3_600_000) continue;
      valid.push(shift);
      if (shift.code !== "U" && shift.code !== "K") last = { end: end.getTime() };
    }
  }

  for (const shift of valid) {
    const t = types[shift.code];
    const { start, end } = plannedInterval(shift.date, String(t.start_time), String(t.end_time), TZ);
    const category = shift.code === "U" || shift.code === "K" ? "ABSENCE" : "WORK";
    await sql`INSERT INTO carecore_roster_shifts (id, organization_id, period_id, care_unit_id, employee_id, shift_type_id, category, date,
        planned_start, planned_end, break_minutes, source)
      VALUES (${shift.id}, ${org}, ${periodId[`${shift.unitKey}:${shift.label}`]}, ${unitId[shift.unitKey]}, ${shift.person.id},
        ${String(t.id)}, ${category}, ${shift.date}, ${start.toISOString()}, ${end.toISOString()}, ${Number(t.break_minutes)}, 'SEED')
      ON CONFLICT (id) DO NOTHING`;
  }

  // Zeiteinträge für vergangene Dienste mit kleinen Abweichungen; je Wohngruppe eine grosse
  // Abweichung und ein fehlender Clock-out am letzten Tag.
  const past = valid.filter((shift) => shift.code !== "U" && shift.code !== "K" && shift.date < today);
  const lastDay = addDays(today, -1);
  for (const shift of past) {
    const t = types[shift.code];
    const { start, end } = plannedInterval(shift.date, String(t.start_time), String(t.end_time), TZ);
    const startDelta = pick(`in:${shift.id}`, 21) - 8;
    const bigDeviation = shift.person.key.endsWith(":1") && shift.date === lastDay;
    const endDelta = bigDeviation ? 180 : pick(`out:${shift.id}`, 31) - 10;
    const clockIn = new Date(start.getTime() + startDelta * 60_000);
    const clockOut = new Date(end.getTime() + endDelta * 60_000);
    const missing = shift.person.key.endsWith(":4") && shift.date === lastDay;
    const breakMinutes = Number(t.break_minutes);
    const actual = Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000) - breakMinutes;
    await sql`INSERT INTO carecore_time_entries (id, organization_id, employee_id, care_unit_id, shift_id, date, clock_in, clock_out,
        break_minutes, source, status, actual_minutes, deviation_notified_at)
      VALUES (${id(`entry:${shift.id}`)}, ${org}, ${shift.person.id}, ${unitId[shift.unitKey]}, ${shift.id}, ${shift.date},
        ${clockIn.toISOString()}, ${missing ? null : clockOut.toISOString()}, ${missing ? 0 : breakMinutes}, 'SEED',
        ${missing ? "INCOMPLETE" : shift.label === "prev" ? "APPROVED" : "COMPLETE"}, ${missing ? null : actual},
        ${bigDeviation ? now.toISOString() : null})
      ON CONFLICT (id) DO NOTHING`;
  }

  // Wunschfrei, Dienstwünsche, Tausche, Benachrichtigungen und Audit je Wohngruppe.
  for (const unit of UNITS) {
    const staff = people.filter((p) => !p.lead && p.unitKeys[0] === unit.key);
    const lead = people.find((p) => p.lead && p.unitKeys[0] === unit.key)!;
    const freeDay = (person: Person, from: string) => {
      for (let date = from; date < addDays(from, 30); date = addDays(date, 1))
        if (!valid.some((s) => s.person.id === person.id && s.date === date)) return date;
      return from;
    };
    const nextStart = `${next.year}-${String(next.month).padStart(2, "0")}-01`;
    const requests = [
      {
        key: "open",
        person: staff[0],
        start: addDays(nextStart, 9),
        end: addDays(nextStart, 10),
        status: "OPEN",
        priority: "HIGH",
      },
      {
        key: "approved",
        person: staff[1],
        start: freeDay(staff[1], addDays(today, 3)),
        status: "APPROVED",
        priority: "MEDIUM",
      },
      {
        key: "rejected",
        person: staff[5],
        start: addDays(today, 6),
        end: addDays(today, 6),
        status: "REJECTED",
        priority: "LOW",
      },
    ];
    for (const request of requests)
      await sql`INSERT INTO carecore_time_off_requests (id, organization_id, employee_id, care_unit_id, start_date, end_date, priority,
          comment, status, decided_by, decided_at, decision_comment)
        VALUES (${id(`timeoff:${unit.key}:${request.key}`)}, ${org}, ${request.person.id}, ${unitId[unit.key]}, ${request.start},
          ${request.end ?? request.start}, ${request.priority}, ${request.key === "open" ? "Familienfest" : null}, ${request.status},
          ${request.status === "OPEN" ? null : lead.id}, ${request.status === "OPEN" ? null : now.toISOString()},
          ${request.status === "REJECTED" ? "Besetzung an diesem Tag zu knapp." : null})
        ON CONFLICT (id) DO NOTHING`;
    const spät = String(types.S.id);
    await sql`INSERT INTO carecore_shift_preferences (id, organization_id, employee_id, kind, shift_type_id, weekday, comment)
      VALUES (${id(`pref:${unit.key}:1`)}, ${org}, ${staff[2].id}, 'AVOID_SHIFT_TYPE', ${spät}, 5, 'Freitags lieber kein Spätdienst')
      ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO carecore_shift_preferences (id, organization_id, employee_id, kind, weekday)
      VALUES (${id(`pref:${unit.key}:2`)}, ${org}, ${staff[6].id}, 'PREFER_WEEKDAY', 6) ON CONFLICT (id) DO NOTHING`;

    // Tausche in verschiedenen Status (auf künftigen Diensten derselben Wohngruppe).
    // Gezielt gewählt statt nach Position, damit die Demo an jedem Datum dieselben Fälle zeigt: eine gültige Anfrage
    // (mit Spätdienst), eine abgelehnte und eine, die beim Genehmigen die Ruhezeit der Kollegin verletzt.
    const published = (s: SeedShift) =>
      s.unitKey === unit.key &&
      s.date > addDays(today, 1) &&
      (s.label === "current" || (s.label === "next" && lateInMonth)) &&
      s.code !== "U" &&
      s.code !== "K";
    const working = (s: SeedShift) => s.code !== "U" && s.code !== "K";
    const interval = (date: string, code: string) =>
      plannedInterval(date, String(types[code].start_time), String(types[code].end_time), TZ);
    // Hält `person` mit dem Dienst `code` am `date` die Ruhezeit zu den eigenen Diensten am Vor- und Folgetag ein?
    const restOk = (person: Person, date: string, code: string) => {
      const own = interval(date, code);
      return valid
        .filter(
          (s) =>
            s.person.id === person.id && working(s) && (s.date === addDays(date, -1) || s.date === addDays(date, 1)),
        )
        .every((s) => {
          const other = interval(s.date, s.code);
          const gap =
            other.end <= own.start
              ? own.start.getTime() - other.end.getTime()
              : other.start.getTime() - own.end.getTime();
          return gap >= 11 * 3_600_000;
        });
    };
    const single = staff.filter((p) => p.unitKeys.length === 1);
    const swapCase = (requester: Person | undefined, target: Person | undefined, kind: "valid" | "restBlocked") => {
      if (!requester || !target) return null;
      for (const source of valid.filter((s) => s.person.id === requester.id && published(s))) {
        const other = valid.find((s) => s.person.id === target.id && s.date === source.date && published(s));
        if (!other || other.code === source.code) continue;
        const allowed = (person: Person, code: string) => code !== "N" || !person.excluded.includes("NIGHT");
        if (!allowed(target, source.code) || !allowed(requester, other.code)) continue;
        const targetOk = restOk(target, source.date, source.code);
        const requesterOk = restOk(requester, source.date, other.code);
        if (kind === "valid" && targetOk && requesterOk && (source.code === "S" || other.code === "S"))
          return { source, target: other };
        if (kind === "restBlocked" && !targetOk && requesterOk) return { source, target: other };
      }
      return null;
    };
    const swaps = [
      ["PENDING_TARGET", swapCase(single[0], single[2], "valid")],
      ["DECLINED", swapCase(single[3], single[5], "valid")],
      ["PENDING_APPROVAL", swapCase(single[1], single[4], "restBlocked")],
    ] as const;
    for (const [status, swap] of swaps) {
      if (!swap) continue;
      await sql`INSERT INTO carecore_shift_swaps (id, organization_id, care_unit_id, requester_id, target_employee_id, source_shift_id,
          target_shift_id, source_shift_version, target_shift_version, status, message, responded_at)
        VALUES (${id(`swap:${unit.key}:${status}`)}, ${org}, ${unitId[unit.key]}, ${swap.source.person.id}, ${swap.target.person.id},
          ${swap.source.id}, ${swap.target.id}, 1, 1, ${status}, 'Könnten wir tauschen?',
          ${status === "PENDING_TARGET" ? null : now.toISOString()})
        ON CONFLICT (id) DO NOTHING`;
    }

    const notifications = [
      [
        "open",
        lead.id,
        "shift_time_off_requested",
        "Neuer Wunschfrei-Antrag",
        `${staff[0].name} beantragt Wunschfrei im ${next.month}.`,
      ],
      [
        "deviation",
        lead.id,
        "shift_time_deviation",
        "Arbeitszeitabweichung",
        `${staff[1].name}: +3:00 h gegenüber Dienstplan.`,
      ],
      [
        "missing",
        staff[3].id,
        "shift_clock_out_missing",
        "Ausstempeln fehlt",
        "Für deinen letzten Dienst fehlt das Ausstempeln.",
      ],
    ];
    for (const [key, userId, type, title, body] of notifications)
      await sql`INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type)
        VALUES (${id(`notification:${unit.key}:${key}`)}, ${userId}, ${title}, ${body}, ${type}, 'normal',
          ${userId === lead.id ? "/c/dienstplan/antraege" : "/c/mein-dienstplan/zeiten"}, 'roster')
        ON CONFLICT (id) DO NOTHING`;

    const auditId = id(`audit:${unit.key}:publish`);
    const exists = await sql`SELECT 1 FROM carecore_roster_audit WHERE id = ${auditId}`;
    if (!exists[0])
      await sql`INSERT INTO carecore_roster_audit (id, organization_id, actor_id, actor_label, action, entity_type, entity_id, care_unit_id,
          after_data, source, correlation_id)
        VALUES (${auditId}, ${org}, ${lead.id}, ${lead.name}, 'published', 'period', ${periodId[`${unit.key}:current`]}, ${unitId[unit.key]},
          ${JSON.stringify({ status: "PUBLISHED" })}::jsonb, 'SEED', ${id(`audit-corr:${unit.key}`)})`;
  }

  console.log(
    `Dienstplan-Demo: ${people.length} Personen, ${valid.length} Dienste, ${past.length} Zeiteinträge in ${UNITS.length} Wohngruppen.`,
  );
  console.log(
    `Demo-Logins (nur Entwicklung): demo.leitung.linde / demo.linde.aline … Passwort: ${process.env.ROSTER_DEMO_PASSWORD ? "(aus ROSTER_DEMO_PASSWORD)" : DEMO_PASSWORD}`,
  );
}

await main();
