import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertResident,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import {
  INTERACTION_SEVERITIES,
  findInteractions,
  type InteractionFinding,
  type InteractionRule,
  type InteractionSeverity,
  type InteractionStatus,
} from "@/lib/medication-interactions-shared";

// Wechselwirkungsprüfung. Quelle sind nur die Hinweise, die die Einrichtung selbst erfasst (mit Angabe der Quelle,
// z. B. der betreuenden Apotheke). Eine lizenzierte Arzneimitteldatenbank wird bewusst nicht angebunden: CareOS ist
// kein Medizinprodukt (docs/TODO.md, Entscheid vom 01.10.2026). CareOS erfindet keine Regeln: ohne Hinweis kein
// Treffer – das heisst nicht, dass eine Kombination unbedenklich ist.

const mapRule = (row: Row): InteractionRule => ({
  id: String(row.id),
  substanceA: String(row.substance_a),
  substanceB: String(row.substance_b),
  severity: row.severity as InteractionSeverity,
  description: String(row.description),
  recommendation: String(row.recommendation),
  source: String(row.source),
  updatedAt: iso(row.updated_at) ?? "",
  updatedBy: (row.updated_by_name as string | null) ?? null,
});

async function facilityRules(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT i.*, u.display_name AS updated_by_name FROM carecore_medication_interactions i
    LEFT JOIN carecore_users u ON u.id = i.updated_by
    WHERE i.organization_id = ${ctx.actor.organizationId}
    ORDER BY LOWER(i.substance_a), LOWER(i.substance_b)`) as Row[];
  return rows.map(mapRule);
}

export async function listInteractionRules(ctx: ApiContext): Promise<{
  rules: InteractionRule[];
  status: InteractionStatus;
}> {
  const rules = await facilityRules(ctx);
  return { rules, status: { facilityRules: rules.length, licensedDatabase: null } };
}

function parseRule(body: Record<string, unknown>) {
  const substanceA = text(body.substanceA, 120);
  const substanceB = text(body.substanceB, 120);
  const severity = typeof body.severity === "string" && body.severity in INTERACTION_SEVERITIES ? body.severity : null;
  const description = text(body.description, 2000);
  const recommendation = text(body.recommendation, 2000);
  const source = text(body.source, 240);
  if (!substanceA || !substanceB) throw new ApiError("Bitte beide Wirkstoffe oder Präparate angeben.");
  if (substanceA.toLocaleLowerCase("de-CH") === substanceB.toLocaleLowerCase("de-CH"))
    throw new ApiError("Bitte zwei verschiedene Wirkstoffe angeben.");
  if (!severity) throw new ApiError("Bitte den Schweregrad wählen.");
  if (!description) throw new ApiError("Bitte die Wechselwirkung beschreiben.");
  if (!source) throw new ApiError("Bitte die Quelle angeben (z. B. Apotheke, Fachinformation, Datum).");
  return { substanceA, substanceB, severity: severity as InteractionSeverity, description, recommendation, source };
}

export async function createInteractionRule(ctx: ApiContext, body: Record<string, unknown>) {
  const rule = parseRule(body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_medication_interactions (id, organization_id, substance_a, substance_b, severity, description,
        recommendation, source, created_by, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${rule.substanceA}, ${rule.substanceB}, ${rule.severity},
        ${rule.description}, ${rule.recommendation}, ${rule.source}, ${ctx.actor.id}, ${ctx.actor.id})`,
    auditStatement(ctx, "medication_interaction", id, "created", null, rule),
  ]);
  return id;
}

async function loadRule(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Hinweis");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_medication_interactions
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Hinweis nicht gefunden.", 404);
  return rows[0];
}

export async function updateInteractionRule(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const before = await loadRule(ctx, idInput);
  const rule = parseRule(body);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_medication_interactions SET substance_a = ${rule.substanceA}, substance_b = ${rule.substanceB},
        severity = ${rule.severity}, description = ${rule.description}, recommendation = ${rule.recommendation},
        source = ${rule.source}, updated_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(ctx, "medication_interaction", String(before.id), "updated", mapRule(before), rule),
  ]);
}

export async function deleteInteractionRule(ctx: ApiContext, idInput: unknown) {
  const before = await loadRule(ctx, idInput);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_medication_interactions WHERE id = ${before.id}`,
    auditStatement(ctx, "medication_interaction", String(before.id), "deleted", mapRule(before), null),
  ]);
}

// Laufende (aktive und pausierte) Verordnungen einer Person gegen die Hinweise prüfen.
export async function residentInteractions(ctx: ApiContext, residentIdInput: unknown): Promise<InteractionFinding[]> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [rules, orders] = await Promise.all([
    facilityRules(ctx),
    ctx.sql`
      SELECT o.id, TRIM(COALESCE(m.name, '') || ' ' || COALESCE(m.strength, '')) AS name,
        COALESCE(m.name, '') || ' ' || COALESCE(m.active_ingredient, '') AS text
      FROM carecore_medication_orders o JOIN carecore_medications m ON m.id = o.medication_id
      WHERE o.resident_id = ${residentId} AND o.status IN ('active', 'paused')` as Promise<Row[]>,
  ]);
  if (!rules.length) return [];
  return findInteractions(
    orders.map((order) => ({ id: String(order.id), name: String(order.name), text: String(order.text) })),
    rules,
  );
}
