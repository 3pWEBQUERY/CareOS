import { ApiError, assertResident, text, type ApiContext, type Row, type Sql } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import type { ExportSection, ResidentExport } from "@/lib/data-export-shared";

// Auskunft und Datenexport je Person: alle Einträge mit Bezug zur Akte, nach Bereichen, für eine Kopie an die Person
// bzw. ihre Vertretung. Nur die Administration; jeder Export steht im Protokoll der Akte.
//
// Jede Tabelle mit Personenbezug (Spalte resident_id) steht hier oder in EXPORT_EXCLUDED mit Begründung; ein Test
// prüft, dass keine Tabelle vergessen wird.

type Query = (sql: Sql, id: string) => Promise<unknown>;

export const EXPORT_SECTIONS: Array<{ key: string; title: string; tables: string[]; query: Query }> = [
  {
    key: "resident",
    title: "Stammdaten",
    tables: ["carecore_residents"],
    query: (sql, id) => sql`SELECT * FROM carecore_residents WHERE id = ${id}`,
  },
  {
    key: "stays",
    title: "Aufenthalte",
    tables: ["carecore_resident_stays"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_stays WHERE resident_id = ${id} ORDER BY started_at`,
  },
  {
    key: "contacts",
    title: "Kontaktpersonen",
    tables: ["carecore_resident_contacts"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_contacts WHERE resident_id = ${id}`,
  },
  {
    key: "biography",
    title: "Biografie",
    tables: ["carecore_resident_biographies"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_biographies WHERE resident_id = ${id}`,
  },
  {
    key: "diagnoses",
    title: "Diagnosen",
    tables: ["carecore_resident_diagnoses"],
    query: (sql, id) =>
      sql`SELECT * FROM carecore_resident_diagnoses WHERE resident_id = ${id} ORDER BY status, kind, since_on NULLS LAST`,
  },
  {
    key: "vaccinations",
    title: "Impfungen",
    tables: ["carecore_vaccinations"],
    query: (sql, id) => sql`SELECT * FROM carecore_vaccinations WHERE resident_id = ${id} ORDER BY given_on`,
  },
  {
    key: "belongings",
    title: "Hilfsmittel und persönliche Gegenstände",
    tables: ["carecore_resident_belongings"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_belongings WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "funds",
    title: "Bewohnergelder (Buchungen, Beträge in Rappen bzw. Cent)",
    tables: ["carecore_fund_entries"],
    query: (sql, id) =>
      sql`SELECT * FROM carecore_fund_entries WHERE resident_id = ${id} ORDER BY booked_on, created_at`,
  },
  {
    key: "billing",
    title: "Abrechnung (Pflegestufe, Abwesenheiten, zusätzliche Taxen, Rechnungsadresse, Rechnungen)",
    tables: [
      "carecore_resident_care_levels",
      "carecore_resident_absences",
      "carecore_resident_rates",
      "carecore_resident_billing_addresses",
      "carecore_invoices",
      "carecore_invoice_payments",
    ],
    query: async (sql, id) => {
      const [levels, absences, rates, addresses, invoices, payments] = (await Promise.all([
        sql`SELECT * FROM carecore_resident_care_levels WHERE resident_id = ${id} ORDER BY valid_from, created_at`,
        sql`SELECT * FROM carecore_resident_absences WHERE resident_id = ${id} ORDER BY starts_on, created_at`,
        sql`SELECT a.*, r.name AS rate_name FROM carecore_resident_rates a
          JOIN carecore_billing_rates r ON r.id = a.rate_id WHERE a.resident_id = ${id} ORDER BY a.valid_from, a.created_at`,
        sql`SELECT * FROM carecore_resident_billing_addresses WHERE resident_id = ${id}`,
        sql`SELECT * FROM carecore_invoices WHERE resident_id = ${id} ORDER BY number`,
        sql`SELECT p.*, i.number FROM carecore_invoice_payments p JOIN carecore_invoices i ON i.id = p.invoice_id
          WHERE i.resident_id = ${id} ORDER BY p.paid_on, p.created_at`,
      ])) as Row[][];
      return [
        ...levels.map((row) => ({ entry: "Pflegestufe", ...row })),
        ...absences.map((row) => ({ entry: "Abwesenheit", ...row })),
        ...rates.map((row) => ({ entry: "Zusätzliche Taxe", ...row })),
        ...addresses.map((row) => ({ entry: "Rechnungsadresse", ...row })),
        ...invoices.map((row) => ({ entry: "Rechnung", ...row })),
        ...payments.map((row) => ({ entry: "Zahlung", ...row })),
      ];
    },
  },
  {
    key: "consents",
    title: "Einwilligungen und Freigaben",
    tables: ["carecore_resident_consents"],
    query: (sql, id) =>
      sql`SELECT * FROM carecore_resident_consents WHERE resident_id = ${id} ORDER BY decided_on, created_at`,
  },
  {
    key: "end_of_life",
    title: "Wünsche am Lebensende und Ablauf nach dem Todesfall",
    tables: ["carecore_end_of_life_wishes", "carecore_death_checklist_items"],
    query: async (sql, id) => {
      const [wishes, items] = (await Promise.all([
        sql`SELECT * FROM carecore_end_of_life_wishes WHERE resident_id = ${id}`,
        sql`SELECT * FROM carecore_death_checklist_items WHERE resident_id = ${id} ORDER BY position`,
      ])) as Row[][];
      return [
        ...wishes.map((row) => ({ ...row, art: "Wünsche" })),
        ...items.map((row) => ({ ...row, art: "Checkliste" })),
      ];
    },
  },
  {
    key: "flags",
    title: "Hinweise und Risiken",
    tables: ["carecore_resident_clinical_flags"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_clinical_flags WHERE resident_id = ${id}`,
  },
  {
    key: "documentation",
    title: "Pflegedokumentation",
    tables: ["carecore_documentation_entries", "carecore_visit_resolutions"],
    query: async (sql, id) => {
      const [entries, visits] = (await Promise.all([
        sql`SELECT * FROM carecore_documentation_entries WHERE resident_id = ${id} ORDER BY occurred_at`,
        sql`SELECT v.* FROM carecore_visit_resolutions v JOIN carecore_documentation_entries d ON d.id = v.entry_id
          WHERE d.resident_id = ${id} ORDER BY v.resolved_at`,
      ])) as Row[][];
      return [...entries, ...visits.map((row) => ({ ...row, art: "Rückmeldung zur Visite" }))];
    },
  },
  {
    key: "care_plans",
    title: "Pflegeplanung",
    tables: ["carecore_care_plans", "carecore_care_goals", "carecore_interventions"],
    query: async (sql, id) => {
      const [plans, goals, interventions] = (await Promise.all([
        sql`SELECT * FROM carecore_care_plans WHERE resident_id = ${id} ORDER BY starts_on`,
        sql`SELECT g.* FROM carecore_care_goals g JOIN carecore_care_plans p ON p.id = g.care_plan_id
          WHERE p.resident_id = ${id} ORDER BY g.created_at`,
        sql`SELECT i.* FROM carecore_interventions i JOIN carecore_care_goals g ON g.id = i.care_goal_id
          JOIN carecore_care_plans p ON p.id = g.care_plan_id WHERE p.resident_id = ${id} ORDER BY i.created_at`,
      ])) as Row[][];
      return [
        ...plans.map((row) => ({ ...row, art: "Plan" })),
        ...goals.map((row) => ({ ...row, art: "Ziel" })),
        ...interventions.map((row) => ({ ...row, art: "Massnahme" })),
      ];
    },
  },
  {
    key: "assessments",
    title: "Einschätzungen",
    tables: ["carecore_assessment_records"],
    query: (sql, id) => sql`SELECT * FROM carecore_assessment_records WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "rai",
    title: "Bedarfsabklärung (Kompass)",
    tables: ["carecore_rai_assessments"],
    query: (sql, id) => sql`SELECT * FROM carecore_rai_assessments WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "medication",
    title: "Medikation",
    tables: ["carecore_medication_orders", "carecore_medication_administrations"],
    query: async (sql, id) => {
      const [orders, administrations] = (await Promise.all([
        sql`SELECT o.*, m.name AS medication_name, m.strength AS medication_strength FROM carecore_medication_orders o
          LEFT JOIN carecore_medications m ON m.id = o.medication_id WHERE o.resident_id = ${id} ORDER BY o.created_at`,
        sql`SELECT * FROM carecore_medication_administrations WHERE resident_id = ${id} ORDER BY created_at`,
      ])) as Row[][];
      return [
        ...orders.map((row) => ({ ...row, art: "Verordnung" })),
        ...administrations.map((row) => ({ ...row, art: "Gabe" })),
      ];
    },
  },
  {
    key: "medication_stock",
    title: "Eigene Medikamentenbestände (inkl. Betäubungsmittel)",
    tables: ["carecore_medication_stock", "carecore_medication_stock_movements", "carecore_btm_counts"],
    query: async (sql, id) => {
      const [stock, movements, counts] = (await Promise.all([
        sql`SELECT * FROM carecore_medication_stock WHERE resident_id = ${id}`,
        sql`SELECT * FROM carecore_medication_stock_movements WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT c.* FROM carecore_btm_counts c JOIN carecore_medication_stock s ON s.id = c.stock_id
          WHERE s.resident_id = ${id} ORDER BY c.created_at`,
      ])) as Row[][];
      return [
        ...stock.map((row) => ({ ...row, art: "Bestand" })),
        ...movements.map((row) => ({ ...row, art: "Buchung" })),
        ...counts.map((row) => ({ ...row, art: "Kontrolle" })),
      ];
    },
  },
  {
    key: "pharmacy_orders",
    title: "Bestellungen bei der Apotheke",
    tables: ["carecore_pharmacy_orders", "carecore_pharmacy_order_items"],
    query: async (sql, id) => {
      const [orders, items] = (await Promise.all([
        sql`SELECT * FROM carecore_pharmacy_orders WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT i.* FROM carecore_pharmacy_order_items i JOIN carecore_pharmacy_orders o ON o.id = i.order_id
          WHERE o.resident_id = ${id}`,
      ])) as Row[][];
      return [
        ...orders.map((row) => ({ ...row, art: "Bestellung" })),
        ...items.map((row) => ({ ...row, art: "Position" })),
      ];
    },
  },
  {
    key: "vitals",
    title: "Vitalwerte",
    tables: ["carecore_vital_measurements", "carecore_vital_thresholds"],
    query: async (sql, id) => {
      const [values, thresholds] = (await Promise.all([
        sql`SELECT * FROM carecore_vital_measurements WHERE resident_id = ${id} ORDER BY measured_at`,
        sql`SELECT * FROM carecore_vital_thresholds WHERE resident_id = ${id}`,
      ])) as Row[][];
      return [
        ...values.map((row) => ({ ...row, art: "Messung" })),
        ...thresholds.map((row) => ({ ...row, art: "Grenzwert" })),
      ];
    },
  },
  {
    key: "nutrition",
    title: "Ernährung und Trinken",
    tables: ["carecore_nutrition_plans", "carecore_meal_entries", "carecore_fluid_entries"],
    query: async (sql, id) => {
      const [plans, meals, fluids] = (await Promise.all([
        sql`SELECT * FROM carecore_nutrition_plans WHERE resident_id = ${id}`,
        sql`SELECT * FROM carecore_meal_entries WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT * FROM carecore_fluid_entries WHERE resident_id = ${id} ORDER BY created_at`,
      ])) as Row[][];
      return [
        ...plans.map((row) => ({ ...row, art: "Ernährungsplan" })),
        ...meals.map((row) => ({ ...row, art: "Mahlzeit" })),
        ...fluids.map((row) => ({ ...row, art: "Trinkmenge" })),
      ];
    },
  },
  {
    key: "wounds",
    title: "Wunden",
    tables: ["carecore_wounds", "carecore_wound_entries", "carecore_wound_photos"],
    query: async (sql, id) => {
      const [wounds, entries, photos] = (await Promise.all([
        sql`SELECT * FROM carecore_wounds WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT e.* FROM carecore_wound_entries e JOIN carecore_wounds w ON w.id = e.wound_id WHERE w.resident_id = ${id}
          ORDER BY e.observed_at`,
        sql`SELECT p.id, p.wound_id, p.created_at FROM carecore_wound_photos p JOIN carecore_wounds w ON w.id = p.wound_id
          WHERE w.resident_id = ${id}`,
      ])) as Row[][];
      return [
        ...wounds.map((row) => ({ ...row, art: "Wunde" })),
        ...entries.map((row) => ({ ...row, art: "Verlauf" })),
        ...photos.map((row) => ({ ...row, art: "Foto (Datei separat)" })),
      ];
    },
  },
  {
    key: "body",
    title: "Körperbefunde",
    tables: ["carecore_body_observations"],
    query: (sql, id) => sql`SELECT * FROM carecore_body_observations WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "repositioning",
    title: "Lagerung und Bewegung",
    tables: ["carecore_repositioning_plans", "carecore_repositioning_entries"],
    query: async (sql, id) => {
      const [plans, entries] = (await Promise.all([
        sql`SELECT * FROM carecore_repositioning_plans WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT * FROM carecore_repositioning_entries WHERE resident_id = ${id} ORDER BY performed_at`,
      ])) as Row[][];
      return [...plans.map((row) => ({ ...row, art: "Plan" })), ...entries.map((row) => ({ ...row, art: "Wechsel" }))];
    },
  },
  {
    key: "intervention_proofs",
    title: "Durchführungsnachweis",
    tables: ["carecore_intervention_proofs"],
    query: (sql, id) =>
      sql`SELECT * FROM carecore_intervention_proofs WHERE resident_id = ${id} ORDER BY proof_date, recorded_at`,
  },
  {
    key: "elimination",
    title: "Ausscheidung und Kontinenz",
    tables: ["carecore_elimination_entries"],
    query: (sql, id) => sql`SELECT * FROM carecore_elimination_entries WHERE resident_id = ${id} ORDER BY occurred_at`,
  },
  {
    key: "restraints",
    title: "Freiheitsbeschränkende Massnahmen",
    tables: ["carecore_restraint_measures", "carecore_restraint_reviews"],
    query: async (sql, id) => {
      const [measures, reviews] = (await Promise.all([
        sql`SELECT * FROM carecore_restraint_measures WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT r.* FROM carecore_restraint_reviews r JOIN carecore_restraint_measures m ON m.id = r.measure_id
          WHERE m.resident_id = ${id} ORDER BY r.reviewed_at`,
      ])) as Row[][];
      return [
        ...measures.map((row) => ({ ...row, art: "Massnahme" })),
        ...reviews.map((row) => ({ ...row, art: "Überprüfung" })),
      ];
    },
  },
  {
    key: "isolation",
    title: "Isolation",
    tables: ["carecore_isolation_measures", "carecore_isolation_reviews"],
    query: async (sql, id) => {
      const [measures, reviews] = (await Promise.all([
        sql`SELECT * FROM carecore_isolation_measures WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT r.* FROM carecore_isolation_reviews r JOIN carecore_isolation_measures m ON m.id = r.measure_id
          WHERE m.resident_id = ${id} ORDER BY r.reviewed_at`,
      ])) as Row[][];
      return [
        ...measures.map((row) => ({ ...row, art: "Isolation" })),
        ...reviews.map((row) => ({ ...row, art: "Überprüfung" })),
      ];
    },
  },
  {
    key: "feedback",
    title: "Rückmeldungen und Beschwerden",
    tables: ["carecore_feedback"],
    query: (sql, id) => sql`SELECT * FROM carecore_feedback WHERE resident_id = ${id} ORDER BY received_on, created_at`,
  },
  {
    key: "appointments",
    title: "Termine",
    tables: ["carecore_resident_appointments"],
    query: (sql, id) => sql`SELECT * FROM carecore_resident_appointments WHERE resident_id = ${id} ORDER BY starts_at`,
  },
  {
    key: "supplies",
    title: "Hilfsmittel und Material",
    tables: ["carecore_resident_supplies", "carecore_resident_supply_transactions"],
    query: async (sql, id) => {
      const [supplies, transactions] = (await Promise.all([
        sql`SELECT * FROM carecore_resident_supplies WHERE resident_id = ${id}`,
        sql`SELECT * FROM carecore_resident_supply_transactions WHERE resident_id = ${id} ORDER BY created_at`,
      ])) as Row[][];
      return [
        ...supplies.map((row) => ({ ...row, art: "Bestand" })),
        ...transactions.map((row) => ({ ...row, art: "Buchung" })),
      ];
    },
  },
  {
    key: "services",
    title: "Erfasste Leistungen",
    tables: ["carecore_service_records"],
    query: (sql, id) => sql`SELECT * FROM carecore_service_records WHERE resident_id = ${id} ORDER BY performed_at`,
  },
  {
    key: "activities",
    title: "Teilnahme an Angeboten",
    tables: ["carecore_activity_participations"],
    query: (sql, id) => sql`
      SELECT p.*, a.title AS activity_title, a.starts_at AS activity_starts_at FROM carecore_activity_participations p
      JOIN carecore_activities a ON a.id = p.activity_id WHERE p.resident_id = ${id} ORDER BY a.starts_at`,
  },
  {
    key: "tasks",
    title: "Aufgaben",
    tables: ["carecore_tasks"],
    query: (sql, id) => sql`SELECT * FROM carecore_tasks WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "handovers",
    title: "Übergaben",
    tables: ["carecore_handovers"],
    query: (sql, id) => sql`SELECT * FROM carecore_handovers WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "documents",
    title: "Dokumente (Angaben; Dateien separat)",
    tables: ["carecore_documents"],
    query: (sql, id) => sql`SELECT * FROM carecore_documents WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "quality",
    title: "Ereignisse (z. B. Sturz)",
    tables: ["carecore_quality_events", "carecore_quality_actions"],
    query: async (sql, id) => {
      const [events, actions] = (await Promise.all([
        sql`SELECT * FROM carecore_quality_events WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT a.* FROM carecore_quality_actions a JOIN carecore_quality_events e ON e.id = a.quality_event_id
          WHERE e.resident_id = ${id}`,
      ])) as Row[][];
      return [
        ...events.map((row) => ({ ...row, art: "Ereignis" })),
        ...actions.map((row) => ({ ...row, art: "Massnahme" })),
      ];
    },
  },
  {
    key: "ai_drafts",
    title: "Entwürfe der KI-Assistenz",
    tables: ["carecore_ai_drafts"],
    query: (sql, id) => sql`SELECT * FROM carecore_ai_drafts WHERE resident_id = ${id} ORDER BY created_at`,
  },
  {
    key: "portal",
    title: "Portal: Freigaben, Nachrichten und Zugriffe",
    tables: [
      "carecore_portal_grants",
      "carecore_portal_threads",
      "carecore_portal_messages",
      "carecore_portal_access_log",
    ],
    query: async (sql, id) => {
      const [grants, threads, messages, access] = (await Promise.all([
        sql`SELECT g.*, a.display_name AS account_name, a.kind AS account_kind FROM carecore_portal_grants g
          JOIN carecore_portal_accounts a ON a.id = g.account_id WHERE g.resident_id = ${id}`,
        sql`SELECT * FROM carecore_portal_threads WHERE resident_id = ${id} ORDER BY created_at`,
        sql`SELECT m.* FROM carecore_portal_messages m JOIN carecore_portal_threads t ON t.id = m.thread_id
          WHERE t.resident_id = ${id} ORDER BY m.created_at`,
        sql`SELECT l.action, l.areas, l.created_at, a.display_name AS account_name FROM carecore_portal_access_log l
          JOIN carecore_portal_accounts a ON a.id = l.account_id WHERE l.resident_id = ${id} ORDER BY l.created_at`,
      ])) as Row[][];
      return [
        ...grants.map((row) => ({ ...row, art: "Freigabe" })),
        ...threads.map((row) => ({ ...row, art: "Unterhaltung" })),
        ...messages.map((row) => ({ ...row, art: "Nachricht" })),
        ...access.map((row) => ({ ...row, art: "Zugriff" })),
      ];
    },
  },
  {
    key: "waitlist",
    title: "Anfrage auf der Warteliste",
    tables: ["carecore_waitlist_entries"],
    query: (sql, id) => sql`SELECT * FROM carecore_waitlist_entries WHERE resident_id = ${id}`,
  },
  {
    key: "audit",
    title: "Änderungsprotokoll der Akte",
    tables: [],
    query: (sql, id) => sql`
      SELECT a.created_at, a.entity_type, a.action, a.actor_user_id, a.before_data, a.after_data
      FROM carecore_audit_log a
      WHERE a.entity_id = ${id} OR COALESCE(a.after_data ->> 'residentId', a.before_data ->> 'residentId') = ${id}
      ORDER BY a.created_at`,
  },
];

// Tabellen mit Personenbezug, die bewusst nicht in die Auskunft gehören.
export const EXPORT_EXCLUDED: Record<string, string> = {
  carecore_notifications: "Hinweise im Posteingang der Mitarbeitenden (Kopie bestehender Einträge)",
  carecore_document_reads: "Lesebestätigungen der Mitarbeitenden",
  carecore_handover_reads: "Lesebestätigungen der Mitarbeitenden",
};

const SECRET_COLUMNS = new Set(["storage_key", "photo_storage_key", "password_hash", "token_hash"]);

const clean = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !SECRET_COLUMNS.has(key))
      .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function exportResidentData(
  ctx: ApiContext,
  residentInput: unknown,
  body: Record<string, unknown>,
): Promise<ResidentExport> {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Auskünfte erteilt die Administration.", 403);
  const residentId = await assertResident(ctx, residentInput);
  const requestedBy = text(body.requestedBy, 200);
  if (!requestedBy) throw new ApiError("Bitte angeben, wer die Auskunft verlangt (Person oder Vertretung).");
  const format = body.format === "json" ? "json" : "print";
  const [[resident], [organization]] = (await Promise.all([
    ctx.sql`SELECT first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') AS birth_date FROM carecore_residents
      WHERE id = ${residentId}`,
    ctx.sql`SELECT name FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`,
  ])) as Row[][];
  const sections: ExportSection[] = [];
  for (const section of EXPORT_SECTIONS) {
    const rows = (await section.query(ctx.sql, residentId)) as Array<Record<string, unknown>>;
    sections.push({ key: section.key, title: section.title, rows: rows.map(clean) });
  }
  // Namen der Mitarbeitenden zu allen Kennungen in den Daten.
  const ids = new Set<string>();
  for (const section of sections)
    for (const row of section.rows)
      for (const value of Object.values(row)) if (typeof value === "string" && UUID.test(value)) ids.add(value);
  const staff = ids.size
    ? ((await ctx.sql`SELECT id, display_name FROM carecore_users WHERE id = ANY(${[...ids]}::uuid[])`) as Row[])
    : [];
  // Protokolleintrag zuerst: auch ein abgebrochener Download gilt als Herausgabe.
  await ctx.sql.transaction([
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident",
      entityId: residentId,
      action: "data_exported",
      after: { requestedBy, format, sections: sections.filter((section) => section.rows.length).length },
    }),
  ]);
  const files = sections.find((section) => section.key === "documents")?.rows.length ?? 0;
  const photos =
    sections.find((section) => section.key === "wounds")?.rows.filter((row) => row.art === "Foto (Datei separat)")
      .length ?? 0;
  return {
    format: "carecore-auskunft",
    version: 1,
    generatedAt: new Date().toISOString(),
    organization: String(organization?.name ?? ""),
    resident: {
      id: residentId,
      name: `${resident.first_name} ${resident.last_name}`,
      birthDate: (resident.birth_date as string | null) ?? null,
    },
    requestedBy,
    generatedBy: String(ctx.actor.display_name ?? ""),
    staff: Object.fromEntries(staff.map((row) => [String(row.id), String(row.display_name)])),
    sections,
    notes: [
      files || photos
        ? `Dateien (${files} Dokumente, ${photos} Wundfotos) sind hier nur mit ihren Angaben enthalten; die Dateien selbst gibt die Einrichtung auf Wunsch einzeln heraus.`
        : "Zur Akte sind keine Dateien gespeichert.",
      "Hinweise im Posteingang und Lesebestätigungen der Mitarbeitenden sind nicht enthalten; sie wiederholen nur bestehende Einträge.",
    ],
  };
}
