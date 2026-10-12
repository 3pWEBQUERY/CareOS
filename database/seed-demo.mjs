import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import "./pg-fetch.mjs";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
const sql = neon(connectionString);
const id = (key) => {
  const value = createHash("sha256").update(`carecore-demo-v1:${key}`).digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
const date = (days = 0, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
const day = (days = 0) => date(days).slice(0, 10);
const json = (value) => JSON.stringify(value);
const org = "00000000-0000-4000-8000-000000000101";
const unit = "00000000-0000-4000-8000-000000000202";
const resident = [
  "00000000-0000-4000-8000-000000000401",
  "00000000-0000-4000-8000-000000000402",
  "00000000-0000-4000-8000-000000000403",
];
const users =
  await sql`SELECT id FROM carecore_users WHERE active = TRUE ORDER BY role = 'admin' DESC, created_at LIMIT 1`;
if (!users[0]) throw new Error("Create an employee before seeding demo content.");
const actor = users[0].id;

// Demo organization, care units, rooms and residents. Existing rows are never overwritten.
const site = "00000000-0000-4000-8000-000000000102";
const units = [
  ["00000000-0000-4000-8000-000000000201", "Wohnbereich 1", "EG"],
  [unit, "Wohnbereich 2", "1. OG"],
  ["00000000-0000-4000-8000-000000000203", "Wohnbereich 3", "2. OG"],
  ["00000000-0000-4000-8000-000000000204", "Pflegewohngruppe", "EG"],
];
const rooms = [
  ["00000000-0000-4000-8000-000000000301", units[0][0], "Zimmer 101"],
  ["00000000-0000-4000-8000-000000000302", unit, "Zimmer 207"],
  ["00000000-0000-4000-8000-000000000303", unit, "Zimmer 204"],
  ["00000000-0000-4000-8000-000000000304", units[2][0], "Zimmer 301"],
  ["00000000-0000-4000-8000-000000000305", units[3][0], "Zimmer 12"],
];
const residents = [
  [resident[0], "501", "Hans", "Müller", "male", unit, rooms[1][0], "Sturzrisiko", "critical"],
  [resident[1], "502", "Maria", "Keller", "female", unit, rooms[2][0], "Diabetes", "attention"],
  [resident[2], "503", "Erika", "Meier", "female", unit, rooms[1][0], "Stabil", "stable"],
  [
    "00000000-0000-4000-8000-000000000404",
    "504",
    "Peter",
    "Aebischer",
    "male",
    units[0][0],
    rooms[0][0],
    "Beobachtung",
    "info",
  ],
  [
    "00000000-0000-4000-8000-000000000405",
    "505",
    "Walter",
    "Brunner",
    "male",
    units[2][0],
    rooms[3][0],
    "Stabil",
    "stable",
  ],
  [
    "00000000-0000-4000-8000-000000000406",
    "506",
    "Anna",
    "Berger",
    "female",
    units[3][0],
    rooms[4][0],
    "Stabil",
    "stable",
  ],
];
await sql`INSERT INTO carecore_organizations (id, name) VALUES (${org}, 'Alterszentrum Sonnengarten') ON CONFLICT (id) DO NOTHING`;
await sql`INSERT INTO carecore_sites (id, organization_id, name) VALUES (${site}, ${org}, 'Alterszentrum Sonnengarten') ON CONFLICT (id) DO NOTHING`;
for (const [unitId, name, floor] of units)
  await sql`INSERT INTO carecore_care_units (id, site_id, name, floor, capacity) VALUES (${unitId}, ${site}, ${name}, ${floor}, 12) ON CONFLICT (id) DO NOTHING`;
for (const [roomId, careUnitId, name] of rooms)
  await sql`INSERT INTO carecore_rooms (id, care_unit_id, name, room_number) VALUES (${roomId}, ${careUnitId}, ${name}, ${name.replace("Zimmer ", "")}) ON CONFLICT (id) DO NOTHING`;
for (const [residentId, stay, firstName, lastName, gender, careUnitId, roomId, flag, tone] of residents) {
  await sql`INSERT INTO carecore_residents (id, organization_id, first_name, last_name, gender, status, risk_flags) VALUES (${residentId}, ${org}, ${firstName}, ${lastName}, ${gender}, 'active', ${json([{ label: flag, tone }])}::jsonb) ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id) VALUES (${`00000000-0000-4000-8000-000000000${stay}`}, ${residentId}, ${careUnitId}, ${roomId}) ON CONFLICT (id) DO NOTHING`;
}
// The seeding user joins the demo organization only if not yet assigned to one.
await sql`INSERT INTO carecore_user_profiles (user_id, organization_id, primary_care_unit_id) VALUES (${actor}, ${org}, ${unit}) ON CONFLICT (user_id) DO UPDATE SET organization_id = COALESCE(carecore_user_profiles.organization_id, EXCLUDED.organization_id), primary_care_unit_id = COALESCE(carecore_user_profiles.primary_care_unit_id, EXCLUDED.primary_care_unit_id)`;
await sql`INSERT INTO carecore_user_unit_assignments (user_id, care_unit_id, assignment_role, is_primary) VALUES (${actor}, ${unit}, 'Pflegefachperson', TRUE) ON CONFLICT (user_id, care_unit_id) DO NOTHING`;
console.log("Demo-Organisation, Wohnbereiche und Bewohner vorbereitet");
const tables = new Set([
  "carecore_resident_contacts",
  "carecore_resident_clinical_flags",
  "carecore_documentation_entries",
  "carecore_care_plans",
  "carecore_care_goals",
  "carecore_interventions",
  "carecore_assessments",
  "carecore_assessment_records",
  "carecore_vital_measurements",
  "carecore_vital_thresholds",
  "carecore_medications",
  "carecore_medication_orders",
  "carecore_medication_stock",
  "carecore_wounds",
  "carecore_wound_entries",
  "carecore_nutrition_plans",
  "carecore_fluid_entries",
  "carecore_tasks",
  "carecore_handovers",
  "carecore_conversations",
  "carecore_conversation_members",
  "carecore_messages",
  "carecore_documents",
  "carecore_trainings",
  "carecore_training_enrollments",
  "carecore_quality_events",
  "carecore_quality_actions",
  "carecore_rai_assessments",
  "carecore_ai_drafts",
  "carecore_notifications",
]);
async function seed(table, rows) {
  if (!tables.has(table)) throw new Error(`Unapproved seed table: ${table}`);
  const count = await sql.query(`SELECT COUNT(*)::int AS value FROM ${table}`);
  if (count[0].value > 0) return;
  for (const row of rows) {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await sql.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      columns.map((key) => row[key]),
    );
  }
  console.log(`${table}: ${rows.length} Demo-Einträge vorbereitet`);
}

await seed("carecore_resident_contacts", [
  {
    id: id("contact-hans"),
    resident_id: resident[0],
    full_name: "Claudia Müller",
    relationship: "Tochter",
    phone: "+41 79 555 40 21",
    is_primary: true,
    is_emergency_contact: true,
  },
  {
    id: id("contact-maria"),
    resident_id: resident[1],
    full_name: "Markus Keller",
    relationship: "Sohn",
    phone: "+41 79 555 40 22",
    is_primary: true,
    is_emergency_contact: true,
  },
]);
await seed("carecore_resident_clinical_flags", [
  {
    id: id("flag-hans-fall"),
    resident_id: resident[0],
    category: "Sturz",
    label: "Erhöhtes Sturzrisiko",
    severity: "critical",
    details: "Nach Sturzereignis engmaschig beobachten.",
    created_by: actor,
  },
  {
    id: id("flag-maria-glucose"),
    resident_id: resident[1],
    category: "Diabetes",
    label: "Blutzucker beobachten",
    severity: "attention",
    details: "Vor Mahlzeiten messen.",
    created_by: actor,
  },
]);
await seed("carecore_documentation_entries", [
  {
    id: id("doc-hans"),
    resident_id: resident[0],
    care_unit_id: unit,
    author_user_id: actor,
    category: "Beobachtung",
    title: "Sturzkontrolle",
    body: "Neurologische Kontrolle unauffällig. Mobilisation weiterhin begleitet.",
    occurred_at: date(0, -2),
    importance: "important",
  },
  {
    id: id("doc-maria"),
    resident_id: resident[1],
    care_unit_id: unit,
    author_user_id: actor,
    category: "Verlauf",
    title: "Blutzuckerverlauf",
    body: "Blutzucker vor dem Frühstück gemessen. Keine akuten Beschwerden.",
    occurred_at: date(0, -4),
    importance: "observation",
  },
  {
    id: id("doc-erika"),
    resident_id: resident[2],
    care_unit_id: unit,
    author_user_id: actor,
    category: "Medikation",
    title: "Medikationsanpassung",
    body: "Neue Dosierung gemäss ärztlicher Anordnung im Team besprochen.",
    occurred_at: date(-1),
    importance: "visit",
  },
]);
await seed("carecore_care_plans", [
  {
    id: id("plan-hans"),
    resident_id: resident[0],
    owner_user_id: actor,
    care_level: "Pflegestufe 4",
    focus: "Mobilität erhalten und Stürze vermeiden.",
    review_on: day(30),
  },
  {
    id: id("plan-maria"),
    resident_id: resident[1],
    owner_user_id: actor,
    care_level: "Pflegestufe 3",
    focus: "Diabetesversorgung und selbstständige Alltagsaktivitäten.",
    review_on: day(21),
  },
]);
await seed("carecore_care_goals", [
  {
    id: id("goal-hans"),
    care_plan_id: id("plan-hans"),
    category: "Mobilität",
    statement: "Hans Müller bewegt sich mit Begleitung sicher innerhalb des Wohnbereichs.",
    target_date: day(30),
    created_by: actor,
  },
  {
    id: id("goal-maria"),
    care_plan_id: id("plan-maria"),
    category: "Stoffwechsel",
    statement: "Blutzuckerwerte bleiben im vereinbarten Zielbereich.",
    target_date: day(21),
    created_by: actor,
  },
]);
await seed("carecore_interventions", [
  {
    id: id("intervention-hans"),
    care_goal_id: id("goal-hans"),
    title: "Begleitete Mobilisation",
    instructions: "Beim Aufstehen Hilfsmittel bereitstellen und Gangbild beobachten.",
    frequency: "2× täglich",
    responsible_role: "Pflege",
    created_by: actor,
  },
  {
    id: id("intervention-maria"),
    care_goal_id: id("goal-maria"),
    title: "Blutzucker messen",
    instructions: "Vor dem Frühstück messen und dokumentieren.",
    frequency: "Täglich",
    responsible_role: "Pflege",
    created_by: actor,
  },
]);
await seed("carecore_assessments", [
  {
    id: id("assessment-fall"),
    organization_id: org,
    code: "FALL-01",
    name: "Sturzrisiko",
    version: "1.0",
    category: "Risiko",
    definition: json({ questions: ["Mobilität", "Sturzereignisse", "Medikation"] }),
  },
  {
    id: id("assessment-pain"),
    organization_id: org,
    code: "PAIN-01",
    name: "Schmerzeinschätzung",
    version: "1.0",
    category: "Schmerz",
    definition: json({ scale: "NRS", min: 0, max: 10 }),
  },
]);
await seed("carecore_assessment_records", [
  {
    id: id("assessment-record-hans"),
    assessment_id: id("assessment-fall"),
    resident_id: resident[0],
    assessor_user_id: actor,
    status: "in_progress",
    due_on: day(1),
    score: 7,
    answers: json({ mobility: "Begleitung erforderlich" }),
    summary: "Erhöhtes Sturzrisiko.",
  },
  {
    id: id("assessment-record-maria"),
    assessment_id: id("assessment-pain"),
    resident_id: resident[1],
    assessor_user_id: actor,
    status: "completed",
    completed_at: date(-1),
    score: 3,
    answers: json({ nrs: 3 }),
    summary: "Leichte Schmerzen bei Belastung.",
  },
]);
await seed("carecore_vital_measurements", [
  {
    id: id("vital-hans-bp"),
    resident_id: resident[0],
    measured_by: actor,
    measured_at: date(0, -2),
    metric: "Blutdruck",
    value: 132,
    secondary_value: 78,
    unit: "mmHg",
    note: "Nach Sturzkontrolle",
  },
  {
    id: id("vital-hans-pulse"),
    resident_id: resident[0],
    measured_by: actor,
    measured_at: date(0, -2),
    metric: "Puls",
    value: 72,
    unit: "/min",
  },
  {
    id: id("vital-maria-glucose"),
    resident_id: resident[1],
    measured_by: actor,
    measured_at: date(0, -3),
    metric: "Blutzucker",
    value: 7.4,
    unit: "mmol/l",
    status: "attention",
  },
  {
    id: id("vital-erika-temperature"),
    resident_id: resident[2],
    measured_by: actor,
    measured_at: date(0, -1),
    metric: "Temperatur",
    value: 36.8,
    unit: "°C",
  },
]);
await seed("carecore_vital_thresholds", [
  {
    id: id("threshold-bp"),
    organization_id: org,
    metric: "Blutdruck",
    lower_bound: 100,
    upper_bound: 160,
    unit: "mmHg",
    created_by: actor,
  },
  {
    id: id("threshold-glucose"),
    resident_id: resident[1],
    metric: "Blutzucker",
    lower_bound: 4,
    upper_bound: 10,
    unit: "mmol/l",
    created_by: actor,
  },
]);
await seed("carecore_medications", [
  {
    id: id("med-paracetamol"),
    organization_id: org,
    name: "Paracetamol",
    active_ingredient: "Paracetamol",
    form: "Tablette",
    strength: "500 mg",
  },
  {
    id: id("med-metoprolol"),
    organization_id: org,
    name: "Metoprolol",
    active_ingredient: "Metoprolol",
    form: "Tablette",
    strength: "50 mg",
  },
]);
await seed("carecore_medication_orders", [
  {
    id: id("order-hans-prn"),
    resident_id: resident[0],
    medication_id: id("med-paracetamol"),
    prescribed_by: "Dr. Martin Weber",
    indication: "Schmerzen",
    dosage: json({ amount: "1 Tablette", quantity: 1, maxDosesPer24h: 4, minIntervalHours: 6 }),
    route: "oral",
    schedule: json({ type: "prn" }),
    is_prn: true,
    prn_instructions: "Maximal 4 Tabletten in 24 Stunden.",
    start_on: day(-5),
    created_by: actor,
  },
  {
    id: id("order-erika"),
    resident_id: resident[2],
    medication_id: id("med-metoprolol"),
    prescribed_by: "Dr. Martin Weber",
    indication: "Hypertonie",
    dosage: json({ amount: "1 Tablette", quantity: 1 }),
    route: "oral",
    schedule: json({ times: ["08:00"] }),
    start_on: day(-2),
    created_by: actor,
  },
]);
await seed("carecore_medication_stock", [
  {
    id: id("stock-paracetamol"),
    organization_id: org,
    care_unit_id: unit,
    medication_id: id("med-paracetamol"),
    quantity: 42,
    unit: "Tabletten",
    minimum_quantity: 20,
    expires_on: day(180),
    batch_number: "DEMO-PAR-01",
  },
  {
    id: id("stock-metoprolol"),
    organization_id: org,
    care_unit_id: unit,
    medication_id: id("med-metoprolol"),
    quantity: 18,
    unit: "Tabletten",
    minimum_quantity: 25,
    expires_on: day(150),
    batch_number: "DEMO-MET-01",
  },
]);
await seed("carecore_wounds", [
  {
    id: id("wound-hans"),
    resident_id: resident[0],
    title: "Hautrötung am rechten Ellenbogen",
    body_location: "Rechter Ellenbogen",
    diagnosis: "Druckstelle",
    status: "healing",
    severity: "attention",
    discovered_at: date(-4),
    responsible_user_id: actor,
    wound_type: "Dekubitus",
    category: "Kategorie 1",
    origin: "inhouse",
    care_interval_days: 2,
    treatment_plan: "Hautschutz, Druckentlastung durch Lagerung, Kontrolle alle 2 Tage.",
  },
]);
await seed("carecore_wound_entries", [
  {
    id: id("wound-entry-hans"),
    wound_id: id("wound-hans"),
    author_user_id: actor,
    observed_at: date(0, -2),
    length_cm: 2.1,
    width_cm: 1.4,
    entry_type: "Erstbeurteilung",
    pain_score: 2,
    treatment: "Hautschutz und Druckentlastung.",
    note: "Rötung rückläufig.",
  },
]);
await seed("carecore_nutrition_plans", [
  {
    id: id("nutrition-maria"),
    resident_id: resident[1],
    diet: "Diabetesangepasst",
    texture: "Normalkost",
    daily_fluid_target_ml: 1800,
    instructions: "Kohlenhydrate gleichmässig über den Tag verteilen.",
    created_by: actor,
  },
]);
await seed("carecore_fluid_entries", [
  {
    id: id("fluid-maria"),
    resident_id: resident[1],
    entered_by: actor,
    consumed_at: date(0, -1),
    amount_ml: 250,
    beverage: "Wasser",
  },
  {
    id: id("fluid-hans"),
    resident_id: resident[0],
    entered_by: actor,
    consumed_at: date(0, -2),
    amount_ml: 180,
    beverage: "Tee",
  },
]);
await seed("carecore_tasks", [
  {
    id: id("task-glucose"),
    organization_id: org,
    resident_id: resident[1],
    care_unit_id: unit,
    assigned_to: actor,
    created_by: actor,
    title: "Blutzucker kontrollieren",
    category: "Vitalwerte",
    description: "Vor der nächsten Mahlzeit messen und dokumentieren.",
    priority: "high",
    due_at: date(0, 1),
  },
  {
    id: id("task-fall"),
    organization_id: org,
    resident_id: resident[0],
    care_unit_id: unit,
    assigned_to: actor,
    created_by: actor,
    title: "Sturz-Nachkontrolle",
    category: "Pflege",
    description: "Neurologische Verlaufskontrolle durchführen.",
    priority: "critical",
    due_at: date(0, 2),
  },
  {
    id: id("task-med"),
    organization_id: org,
    resident_id: resident[2],
    care_unit_id: unit,
    assigned_to: actor,
    created_by: actor,
    title: "Medikation verabreichen",
    category: "Medikation",
    description: "Metoprolol gemäss aktuellem Plan.",
    due_at: date(0, 3),
  },
]);
await seed("carecore_handovers", [
  {
    id: id("handover-hans"),
    organization_id: org,
    care_unit_id: unit,
    resident_id: resident[0],
    author_user_id: actor,
    content: "Sturzrisiko: Nachkontrolle im Frühdienst fortsetzen.",
    priority: "high",
  },
  {
    id: id("handover-maria"),
    organization_id: org,
    care_unit_id: unit,
    resident_id: resident[1],
    author_user_id: actor,
    content: "Blutzucker vor dem Mittagessen erneut kontrollieren.",
    priority: "normal",
  },
]);
await seed("carecore_conversations", [
  {
    id: id("conversation-care"),
    organization_id: org,
    title: "Pflege · Wohnbereich 2",
    kind: "channel",
    created_by: actor,
  },
]);
await seed("carecore_conversation_members", [{ conversation_id: id("conversation-care"), user_id: actor }]);
await seed("carecore_messages", [
  {
    id: id("message-care"),
    conversation_id: id("conversation-care"),
    author_user_id: actor,
    body: "Bitte die aktuelle Sturzprophylaxe in der Übergabe beachten.",
  },
]);
await seed("carecore_documents", [
  {
    id: id("document-fall-standard"),
    organization_id: org,
    title: "Standard Sturzprävention",
    category: "Standard",
    storage_key: "demo/standard-sturzpraevention",
    mime_type: "text/plain",
    version: "1.0",
    uploaded_by: actor,
  },
  {
    id: id("document-vitals"),
    organization_id: org,
    title: "Weisung Vitalwerte",
    category: "Weisung",
    storage_key: "demo/weisung-vitalwerte",
    mime_type: "text/plain",
    version: "1.0",
    uploaded_by: actor,
  },
]);
await seed("carecore_trainings", [
  {
    id: id("training-fall"),
    organization_id: org,
    title: "Sturzprävention",
    description: "Risikofaktoren erkennen und sichere Mobilisation planen.",
    mandatory: true,
    valid_for_months: 12,
  },
  {
    id: id("training-hygiene"),
    organization_id: org,
    title: "Hygiene im Pflegealltag",
    description: "Händehygiene und Schutzmassnahmen.",
    mandatory: true,
    valid_for_months: 12,
  },
]);
await seed("carecore_training_enrollments", [
  {
    id: id("enrollment-fall"),
    training_id: id("training-fall"),
    user_id: actor,
    status: "in_progress",
    due_on: day(14),
  },
  {
    id: id("enrollment-hygiene"),
    training_id: id("training-hygiene"),
    user_id: actor,
    status: "assigned",
    due_on: day(30),
  },
]);
await seed("carecore_quality_events", [
  {
    id: id("quality-fall"),
    organization_id: org,
    resident_id: resident[0],
    care_unit_id: unit,
    reported_by: actor,
    type: "Sturz",
    severity: "attention",
    status: "investigating",
    occurred_at: date(-1),
    description: "Beinahe-Sturz beim Aufstehen. Umgebung und Hilfsmittel geprüft.",
  },
]);
await seed("carecore_quality_actions", [
  {
    id: id("quality-action-fall"),
    organization_id: org,
    quality_event_id: id("quality-fall"),
    care_unit_id: unit,
    title: "Sturzprävention im Teambriefing",
    description: "Transfers mit Rollator und Nachtlicht im Frühdienst besprechen.",
    owner_user_id: actor,
    due_on: day(7),
    status: "planned",
    created_by: actor,
  },
  {
    id: id("quality-action-cart"),
    organization_id: org,
    title: "Kontrollrunde Medikationswagen",
    description: "Temperatur und Verfallsdaten aller Medikationswagen prüfen.",
    owner_user_id: actor,
    due_on: day(2),
    status: "open",
    created_by: actor,
  },
]);
await seed("carecore_rai_assessments", [
  // Begonnene Abklärung mit dem CareOS Kompass (Mobilität teilweise beantwortet) und eine geplante.
  {
    id: id("rai-hans"),
    resident_id: resident[0],
    responsible_user_id: actor,
    assessment_type: "CareCore Kompass 1",
    status: "in_progress",
    due_on: day(2),
    started_at: date(-3),
    progress: 3,
    data: json({
      kompass: 1,
      occasion: "routine",
      assessedOn: day(-3),
      participants: ["Person selbst", "Pflegeteam"],
      answers: { "mobility.bed": "0", "mobility.transfer": "2", "mobility.walk_in": "1" },
      domains: {},
      summary: "",
    }),
  },
  {
    id: id("rai-maria"),
    resident_id: resident[1],
    responsible_user_id: actor,
    assessment_type: "CareCore Kompass 1",
    status: "new",
    due_on: day(28),
    progress: 0,
    data: json({}),
  },
]);
await seed("carecore_ai_drafts", [
  {
    id: id("ai-handover"),
    organization_id: org,
    resident_id: resident[0],
    requested_by: actor,
    type: "Übergabe",
    prompt: "Aktuelle Hinweise strukturieren",
    content: "Sturzrisiko und Kontrollbedarf für die Übergabe zusammengefasst.",
  },
]);
await seed("carecore_notifications", [
  {
    id: id("notification-fall"),
    user_id: actor,
    title: "Sturzkontrolle fällig",
    body: "Bitte die neurologische Kontrolle für Hans Müller dokumentieren.",
    type: "task",
    priority: "high",
    link_url: "/c/betrieb/aufgaben",
  },
  {
    id: id("notification-med"),
    user_id: actor,
    title: "Medikationsrunde",
    body: "Eine geplante Gabe steht im Wohnbereich 2 an.",
    type: "medication",
    priority: "normal",
    link_url: "/c/medikation/runde",
  },
]);
console.log("CareOS demo seed completed. Existing table contents were preserved.");
