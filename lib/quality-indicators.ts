import { assertUuid, iso, type ApiContext, type Row } from "@/lib/api-context";
import type { IndicatorResult, QualityIndicators } from "@/lib/quality-indicators-shared";

// Medizinische Qualitätsindikatoren (MQI) aus den Daten von CareOS, Stichtag heute. Nur Statistik für das interne
// Qualitätsmanagement: CareOS beurteilt keine einzelne Person. Wo die Daten die Definition nicht vollständig
// abbilden, steht das als „Annäherung“ beim Indikator.

const DAY = 86_400_000;
const PRESSURE_CATEGORIES = [
  "Kategorie 2",
  "Kategorie 3",
  "Kategorie 4",
  "Keiner Kategorie zuordenbar",
  "Vermutete tiefe Gewebeschädigung",
];

type Person = { id: string; name: string; room: string };

const percent = (numerator: number, denominator: number) =>
  denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;

// Wirkstoffe eines Präparats laut Präparatestamm; Kombinationen sind mit Komma, „+“ oder „/“ getrennt.
export function substancesOf(activeIngredient: string | null, name: string) {
  const source = activeIngredient?.trim() || name.trim();
  return source
    .split(/\s*(?:,|\+|\/|;|\bund\b)\s*/i)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

// Gewichtsverlust: letztes Gewicht verglichen mit dem jüngsten Gewicht, das mindestens 30 bzw. 180 Tage davor liegt.
export function weightLoss(series: Array<{ at: number; kg: number }>) {
  const sorted = [...series].sort((a, b) => a.at - b.at);
  const last = sorted.at(-1);
  if (!last) return null;
  const before = (days: number) => sorted.filter((item) => item.at <= last.at - days * DAY).at(-1) ?? null;
  const ref30 = before(30);
  const ref180 = before(180);
  if (!ref30 && !ref180) return null;
  const loss = (ref: { kg: number } | null) => (ref ? ((ref.kg - last.kg) / ref.kg) * 100 : null);
  return { loss30: loss(ref30), loss180: loss(ref180) };
}

export async function qualityIndicators(ctx: ApiContext, careUnitInput: string | null): Promise<QualityIndicators> {
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const org = ctx.actor.organizationId;
  const people = (await ctx.sql`
    SELECT r.id, r.first_name || ' ' || r.last_name AS name, COALESCE(ro.name, '') AS room
    FROM carecore_residents r
    JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    WHERE r.organization_id = ${org} AND r.status = 'active'
      AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
    ORDER BY r.last_name, r.first_name`) as Row[];
  const ids = people.map((row) => String(row.id));
  const byId = new Map<string, Person>(
    people.map((row) => [String(row.id), { id: String(row.id), name: String(row.name), room: String(row.room) }]),
  );
  const [weights, restraints, doses, pain, wounds] = (await Promise.all([
    ctx.sql`
      SELECT resident_id, measured_at, value FROM carecore_vital_measurements
      WHERE resident_id = ANY(${ids}::uuid[]) AND metric = 'Gewicht' AND measured_at > NOW() - INTERVAL '400 days'`,
    // Täglich in den letzten 7 Tagen: seit mindestens 7 Tagen laufend und nicht beendet.
    ctx.sql`
      SELECT resident_id, kind, description, schedule FROM carecore_restraint_measures
      WHERE organization_id = ${org} AND resident_id = ANY(${ids}::uuid[]) AND ended_at IS NULL
        AND starts_at <= NOW() - INTERVAL '7 days'`,
    ctx.sql`
      SELECT a.resident_id, m.name, m.active_ingredient
      FROM carecore_medication_administrations a
      JOIN carecore_medication_orders o ON o.id = a.medication_order_id
      JOIN carecore_medications m ON m.id = o.medication_id
      WHERE a.resident_id = ANY(${ids}::uuid[]) AND a.status = 'administered'
        AND COALESCE(a.administered_at, a.scheduled_at) > NOW() - INTERVAL '7 days'`,
    ctx.sql`
      SELECT rec.resident_id, rec.score, (rec.completed_at AT TIME ZONE o.timezone)::date::text AS day
      FROM carecore_assessment_records rec
      JOIN carecore_assessments a ON a.id = rec.assessment_id AND a.code = 'NRS'
      JOIN carecore_organizations o ON o.id = a.organization_id
      WHERE a.organization_id = ${org} AND rec.resident_id = ANY(${ids}::uuid[]) AND rec.status = 'completed'
        AND rec.completed_at > ((NOW() AT TIME ZONE o.timezone)::date - 2)::timestamp AT TIME ZONE o.timezone`,
    ctx.sql`
      SELECT resident_id, title, category FROM carecore_wounds
      WHERE resident_id = ANY(${ids}::uuid[]) AND status IN ('active', 'healing') AND wound_type = 'Dekubitus'
        AND origin = 'inhouse' AND category = ANY(${PRESSURE_CATEGORIES})`,
  ])) as Row[][];

  const list = (entries: Map<string, string>) =>
    [...entries].map(([id, detail]) => ({ ...(byId.get(id) as Person), detail }));
  const result = (
    base: Omit<IndicatorResult, "numerator" | "percent" | "residents">,
    entries: Map<string, string>,
  ): IndicatorResult => ({
    ...base,
    numerator: entries.size,
    percent: percent(entries.size, base.denominator),
    residents: list(entries),
  });

  // Mangelernährung
  const malnutrition = new Map<string, string>();
  let weightAssessable = 0;
  for (const id of ids) {
    const loss = weightLoss(
      weights
        .filter((row) => row.resident_id === id)
        .map((row) => ({ at: Date.parse(iso(row.measured_at) ?? ""), kg: Number(row.value) })),
    );
    if (!loss) continue;
    weightAssessable += 1;
    const parts = [
      loss.loss30 !== null && loss.loss30 >= 5 && `${loss.loss30.toFixed(1)} % in 30 Tagen`,
      loss.loss180 !== null && loss.loss180 >= 10 && `${loss.loss180.toFixed(1)} % in 180 Tagen`,
    ].filter(Boolean);
    if (parts.length) malnutrition.set(id, `Gewichtsverlust ${parts.join(", ")}`);
  }

  const restraintSet = (kinds: string[]) => {
    const entries = new Map<string, string>();
    for (const row of restraints)
      if (kinds.includes(String(row.kind)))
        entries.set(String(row.resident_id), [row.description, row.schedule].filter(Boolean).join(" · ") || "laufend");
    return entries;
  };

  // Polymedikation
  const substances = new Map<string, Set<string>>();
  for (const row of doses) {
    const set = substances.get(String(row.resident_id)) ?? new Set<string>();
    for (const substance of substancesOf(row.active_ingredient as string | null, String(row.name))) set.add(substance);
    substances.set(String(row.resident_id), set);
  }
  const polymedication = new Map<string, string>();
  for (const [id, set] of substances) if (set.size >= 9) polymedication.set(id, `${set.size} Wirkstoffe`);

  // Schmerz (Selbsteinschätzung) aus der NRS: an jedem der letzten 3 Tage mindestens „mittlerer Schmerz“ (NRS ≥ 4).
  const painDays = new Map<string, Map<string, number>>();
  for (const row of pain) {
    const days = painDays.get(String(row.resident_id)) ?? new Map<string, number>();
    days.set(String(row.day), Math.max(days.get(String(row.day)) ?? 0, Number(row.score)));
    painDays.set(String(row.resident_id), days);
  }
  const painful = new Map<string, string>();
  for (const [id, days] of painDays)
    if (days.size === 3 && [...days.values()].every((score) => score >= 4))
      painful.set(id, `NRS ${[...days.values()].join(", ")}`);

  const pressure = new Map<string, string>();
  for (const row of wounds) pressure.set(String(row.resident_id), `${row.category} · ${row.title}`);

  const population = ids.length;
  return {
    measuredAt: new Date().toISOString(),
    careUnitId,
    population,
    indicators: [
      result(
        {
          key: "malnutrition",
          title: "Mangelernährung",
          definition: "Gewichtsverlust von 5 % und mehr in 30 Tagen oder 10 % und mehr in 180 Tagen.",
          method:
            "Letztes erfasstes Gewicht verglichen mit dem jüngsten Gewicht, das mindestens 30 bzw. 180 Tage davor liegt.",
          basis: "exact",
          denominator: weightAssessable,
          notAssessable: population - weightAssessable,
        },
        malnutrition,
      ),
      result(
        {
          key: "trunk_restraint",
          title: "Rumpffixation / Sitzgelegenheit",
          definition:
            "Tägliche Fixierung des Rumpfes oder Sitzgelegenheit, die am selbständigen Aufstehen hindert, in den letzten 7 Tagen.",
          method:
            "Laufende FBM „Gurt / Fixierung“ oder „Therapietisch / Stuhlbrett“, seit mindestens 7 Tagen. Ob täglich, steht im Zeitraum der Massnahme.",
          basis: "approximation",
          denominator: population,
          notAssessable: 0,
        },
        restraintSet(["belt", "therapy_table"]),
      ),
      result(
        {
          key: "bed_rails",
          title: "Bettgitter",
          definition:
            "Täglicher Gebrauch von Bettgittern oder anderen Einrichtungen an allen offenen Seiten des Bettes in den letzten 7 Tagen.",
          method:
            "Laufende FBM „Bettseitenteile“ seit mindestens 7 Tagen. Ob alle offenen Seiten betroffen sind, steht in der Beschreibung.",
          basis: "approximation",
          denominator: population,
          notAssessable: 0,
        },
        restraintSet(["bed_rails"]),
      ),
      result(
        {
          key: "polymedication",
          title: "Polymedikation",
          definition: "9 und mehr Wirkstoffe in den letzten 7 Tagen eingenommen.",
          method:
            "Verschiedene Wirkstoffe der in den letzten 7 Tagen verabreichten Gaben (inkl. Reserve), laut Präparatestamm; ohne Wirkstoffangabe zählt das Präparat.",
          basis: "approximation",
          denominator: population,
          notAssessable: 0,
        },
        polymedication,
      ),
      result(
        {
          key: "pain_self",
          title: "Schmerz (Selbsteinschätzung)",
          definition:
            "Täglich mässige bis sehr starke Schmerzen oder nicht täglich sehr starke Schmerzen in den letzten 3 Tagen.",
          method:
            "Numerische Rating-Skala (NRS): an jedem der letzten 3 Tage mindestens „mittlerer Schmerz“ (4 bis 10). Nenner: Personen mit NRS-Einschätzung in diesem Zeitraum.",
          basis: "approximation",
          denominator: painDays.size,
          notAssessable: population - painDays.size,
        },
        painful,
      ),
      result(
        {
          key: "pressure_ulcer",
          title: "Dekubitus",
          definition:
            "Aktuell ein im Heim entstandener Dekubitus Kategorie 2–4 oder keiner Kategorie zuordenbar (inkl. vermutete tiefe Gewebeschädigung).",
          method: "Offene Wunden der Art Dekubitus, im Haus entstanden, mit dieser Kategorie.",
          basis: "exact",
          denominator: population,
          notAssessable: 0,
        },
        pressure,
      ),
    ],
  };
}
