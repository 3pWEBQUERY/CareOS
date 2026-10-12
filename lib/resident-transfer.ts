import { randomUUID } from "node:crypto";
import { type ApiContext, iso, type Row } from "./api-context";
import { listOrders } from "./medication-orders";
import { recordSummary } from "./resident-record";
import type { TransferSheet } from "./resident-transfer-shared";
import { auditOrigin } from "@/lib/audit-origin";
import { organizationCountry } from "@/lib/organization-country";
import { activeIsolations } from "@/lib/hygiene";
import { readDiagnoses } from "@/lib/diagnoses";
import { readBelongings } from "@/lib/belongings";
import { TRANSFER_KINDS } from "@/lib/belongings-shared";
import { isolationLabel, type IsolationKind } from "@/lib/hygiene-shared";
import { activeRestraints } from "@/lib/restraints";
import { restraintLabel, type RestraintKind } from "@/lib/restraints-shared";

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// Überleitungsbogen (z. B. Spitaleinweisung): alle für die Weiterbehandlung nötigen Angaben aus der Akte
// auf einen Blick. Das Erstellen wird protokolliert, weil Gesundheitsdaten die Einrichtung verlassen.
export async function transferSheet(ctx: ApiContext, residentIdInput: unknown): Promise<TransferSheet> {
  const summary = await recordSummary(ctx, residentIdInput);
  const residentId = String(residentIdInput);
  const { sql } = ctx;
  const restraints = await activeRestraints(ctx, residentId);
  const isolations = await activeIsolations(ctx, residentId);
  const diagnoses = (await readDiagnoses(ctx, residentId)).filter((item) => item.status === "current");
  const belongings = (await readBelongings(ctx, residentId)).filter(
    (item) => !item.removed && TRANSFER_KINDS.includes(item.kind),
  );
  const vaccinations = (await sql`
    SELECT DISTINCT ON (lower(target)) target, to_char(given_on, 'YYYY-MM-DD') AS given_on
    FROM carecore_vaccinations WHERE resident_id = ${residentId}
    ORDER BY lower(target), given_on DESC`) as Row[];
  const [facility, resident, contacts, flags, nutrition, plan, wounds, body, vitals, notes, orders] =
    (await Promise.all([
      sql`
      SELECT o.name AS organization, s.name AS site, s.address_line1, s.postal_code, s.city, s.phone, s.email,
        cu.name AS unit, cu.floor, ro.name AS room
      FROM carecore_residents r
      JOIN carecore_organizations o ON o.id = r.organization_id
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_sites s ON s.id = cu.site_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.id = ${residentId}`,
      sql`SELECT medication_allergies FROM carecore_residents WHERE id = ${residentId}`,
      sql`SELECT full_name, relationship, phone, email, is_primary, is_emergency_contact FROM carecore_resident_contacts
      WHERE resident_id = ${residentId} ORDER BY is_primary DESC, is_emergency_contact DESC, full_name`,
      sql`SELECT label, category, severity, details FROM carecore_resident_clinical_flags
      WHERE resident_id = ${residentId} AND active = TRUE ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END, created_at DESC`,
      sql`SELECT diet, texture, allergies, daily_fluid_target_ml, instructions FROM carecore_nutrition_plans
      WHERE resident_id = ${residentId} AND active = TRUE ORDER BY updated_at DESC LIMIT 1`,
      sql`SELECT p.focus, COALESCE(json_agg(json_build_object('category', g.category, 'statement', g.statement) ORDER BY g.category)
        FILTER (WHERE g.id IS NOT NULL), '[]') AS goals
      FROM carecore_care_plans p LEFT JOIN carecore_care_goals g ON g.care_plan_id = p.id AND g.status = 'active'
      WHERE p.resident_id = ${residentId} AND p.status = 'active' GROUP BY p.id, p.updated_at ORDER BY p.updated_at DESC LIMIT 1`,
      sql`SELECT title, body_location, status, severity FROM carecore_wounds
      WHERE resident_id = ${residentId} AND status IN ('active', 'healing') ORDER BY severity = 'critical' DESC, created_at DESC`,
      sql`SELECT kind, label, location, status FROM carecore_body_observations
      WHERE resident_id = ${residentId} AND archived_at IS NULL ORDER BY created_at DESC`,
      sql`SELECT DISTINCT ON (metric) metric, value, secondary_value, unit, status, measured_at FROM carecore_vital_measurements
      WHERE resident_id = ${residentId} AND measured_at > NOW() - INTERVAL '14 days' ORDER BY metric, measured_at DESC`,
      sql`SELECT d.category, d.title, d.body, d.occurred_at, d.importance, u.display_name AS author
      FROM carecore_documentation_entries d LEFT JOIN carecore_users u ON u.id = d.author_user_id
      WHERE d.resident_id = ${residentId} AND d.occurred_at > NOW() - INTERVAL '72 hours'
      ORDER BY d.occurred_at DESC LIMIT 8`,
      listOrders(ctx, residentId),
    ])) as [
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Row[],
      Awaited<ReturnType<typeof listOrders>>,
    ];

  const place = facility[0] ?? {};
  const allergies = [text(resident[0]?.medication_allergies), text(nutrition[0]?.allergies)].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  const sheet: TransferSheet = {
    createdAt: new Date().toISOString(),
    createdBy: ctx.actor.display_name,
    facility: {
      organization: String(place.organization ?? ""),
      site: text(place.site),
      address: [text(place.address_line1), [text(place.postal_code), text(place.city)].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", "),
      phone: text(place.phone),
      email: text(place.email),
      unit: text(place.unit),
      floor: text(place.floor),
      room: text(place.room),
    },
    master: summary.master,
    representative: summary.representative,
    country: await organizationCountry(ctx),
    careLevel: summary.careLevel,
    primaryNurse: summary.primaryNurse,
    allergies,
    belongings: belongings.map(({ name, kind, marking }) => ({ name, kind, marking })),
    vaccinations: vaccinations.map((row) => ({ target: String(row.target), givenOn: String(row.given_on) })),
    diagnoses: diagnoses.map(({ label, icdCode, kind, sinceOn }) => ({ label, icdCode, kind, sinceOn })),
    contacts: contacts.map((row) => ({
      name: String(row.full_name),
      relationship: text(row.relationship),
      phone: text(row.phone),
      email: text(row.email),
      primary: Boolean(row.is_primary),
      emergency: Boolean(row.is_emergency_contact),
    })),
    flags: flags.map((row) => ({
      label: String(row.label),
      category: String(row.category),
      severity: String(row.severity) as "critical" | "attention" | "info",
      details: text(row.details),
    })),
    isolations: isolations.map((row) => ({
      label: isolationLabel(row.kind as IsolationKind),
      reason: String(row.reason),
      precautions: text(row.precautions),
      since: iso(row.starts_at) ?? "",
    })),
    restraints: restraints.map((row) => ({
      label: restraintLabel({ kind: row.kind as RestraintKind, description: String(row.description) }),
      schedule: text(row.schedule),
      since: iso(row.starts_at) ?? "",
    })),
    nutrition: nutrition[0]
      ? {
          diet: text(nutrition[0].diet),
          texture: text(nutrition[0].texture),
          fluidTargetMl:
            nutrition[0].daily_fluid_target_ml === null ? null : Number(nutrition[0].daily_fluid_target_ml),
          instructions: text(nutrition[0].instructions),
        }
      : null,
    carePlan: plan[0]
      ? {
          focus: text(plan[0].focus),
          goals: (plan[0].goals as Array<{ category: string; statement: string }>) ?? [],
        }
      : null,
    medication: orders.map((order) => ({
      name: [order.name, order.strength].filter(Boolean).join(" "),
      controlled: order.controlled,
      form: order.form,
      route: order.route,
      amount: order.amount,
      times: order.times,
      weekdays: order.weekdays,
      prn: order.isPrn,
      prnInstructions: order.prnInstructions || null,
      maxDosesPer24h: order.maxDosesPer24h,
      indication: order.indication || null,
      paused: order.status === "paused",
      lastAdministeredAt: order.lastAdministeredAt,
    })),
    wounds: wounds.map((row) => ({
      title: String(row.title),
      location: String(row.body_location),
      status: String(row.status),
      critical: row.severity === "critical",
    })),
    bodyFindings: body.map((row) => ({
      kind: String(row.kind),
      label: String(row.label),
      location: String(row.location),
      status: String(row.status),
    })),
    vitals: vitals.map((row) => ({
      metric: String(row.metric),
      value: Number(row.value),
      secondaryValue: row.secondary_value === null ? null : Number(row.secondary_value),
      unit: String(row.unit),
      status: String(row.status),
      measuredAt: iso(row.measured_at) ?? "",
    })),
    recentNotes: notes.map((row) => ({
      category: String(row.category),
      title: text(row.title),
      body: String(row.body),
      occurredAt: iso(row.occurred_at) ?? "",
      important: row.importance === "critical" || row.importance === "important",
      author: text(row.author),
    })),
  };

  await sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'resident_transfer', ${residentId}, 'created',
      ${JSON.stringify({ residentId, sections: ["Stammdaten", "Kontakte", "Medikation", "Risiken", "Befunde", "Vitalwerte"] })}::jsonb)`;
  return sheet;
}
