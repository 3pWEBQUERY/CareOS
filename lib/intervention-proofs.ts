import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { initials, roundForTime } from "@/lib/medication-shared";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  DAY_PARTS,
  PROOF_OUTCOMES,
  slotOrder,
  type DayPart,
  type Deviation,
  type ProofOutcome,
  type ProofView,
} from "@/lib/intervention-proofs-shared";

// Durchführungsnachweis nach Abweichungen: Je Person und Tageszeit bestätigt eine Pflegeperson die geplanten
// Massnahmen („wie geplant“); nur Abweichungen werden mit Grund einzeln erfasst und als wichtiger Eintrag in die
// Pflegedokumentation übernommen. Was wann geplant ist, legt die Pflegeplanung fest; CareOS vermerkt nichts von
// sich aus als durchgeführt.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

function dayPartOf(value: unknown): DayPart | null {
  return typeof value === "string" && value in DAY_PARTS ? (value as DayPart) : null;
}

// Tag und Tageszeit jetzt in der Zeitzone der Einrichtung; nach Mitternacht gehört die Nacht zum Vortag.
async function currentSlot(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today,
      to_char(NOW() AT TIME ZONE timezone - INTERVAL '1 day', 'YYYY-MM-DD') AS yesterday,
      to_char(NOW() AT TIME ZONE timezone, 'HH24:MI') AS time
    FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const time = String(row.time);
  const dayPart = roundForTime(time);
  return { date: dayPart === "night" && time < "05:00" ? String(row.yesterday) : String(row.today), dayPart };
}

function slotOf(dateInput: unknown, dayPartInput: unknown, current: { date: string; dayPart: DayPart }) {
  const date = typeof dateInput === "string" && DATE.test(dateInput) ? dateInput : current.date;
  const dayPart = dayPartOf(dayPartInput) ?? (date === current.date ? current.dayPart : "morning");
  return { date, dayPart };
}

// Laufende Massnahmen mit dieser Tageszeit (aus der aktuellen Pflegeplanung) und ihre Nachweise.
function dueInterventions(ctx: ApiContext, date: string, dayPart: DayPart, residentId: string | null) {
  return ctx.sql`
    SELECT p.resident_id, i.id, i.title, i.instructions, i.frequency, i.responsible_role, g.statement AS goal,
      pr.id AS proof_id, pr.outcome, pr.reason, pr.recorded_at, COALESCE(u.display_name, 'Unbekannt') AS author
    FROM carecore_interventions i
    JOIN carecore_care_goals g ON g.id = i.care_goal_id AND g.status = 'active'
    JOIN carecore_care_plans p ON p.id = g.care_plan_id AND p.status IN ('draft', 'active', 'review')
    JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_intervention_proofs pr ON pr.intervention_id = i.id AND pr.proof_date = ${date}::date
      AND pr.day_part = ${dayPart} AND pr.cancelled_at IS NULL
    LEFT JOIN carecore_users u ON u.id = pr.author_user_id
    WHERE i.status = 'active' AND ${dayPart} = ANY(i.day_parts)
      AND (${residentId}::uuid IS NULL OR p.resident_id = ${residentId}::uuid)
    ORDER BY g.created_at, i.created_at` as Promise<Row[]>;
}

export async function proofView(
  ctx: ApiContext,
  params: { careUnitId: unknown; date: unknown; dayPart: unknown },
): Promise<ProofView> {
  const careUnitId = params.careUnitId ? assertUuid(params.careUnitId, "Wohnbereich") : null;
  const current = await currentSlot(ctx);
  const { date, dayPart } = slotOf(params.date, params.dayPart, current);
  const [residents, interventions] = await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit
      FROM carecore_residents r
      JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name` as Promise<Row[]>,
    dueInterventions(ctx, date, dayPart, null),
  ]);
  const byResident = new Map<string, Row[]>();
  for (const row of interventions)
    byResident.set(String(row.resident_id), [...(byResident.get(String(row.resident_id)) ?? []), row]);
  return {
    date,
    dayPart,
    current,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    residents: residents
      .filter((row) => byResident.has(String(row.id)))
      .map((row) => {
        const name = `${row.first_name} ${row.last_name}`;
        return {
          id: String(row.id),
          name,
          initials: initials(name),
          room: String(row.room),
          careUnit: String(row.care_unit),
          interventions: (byResident.get(String(row.id)) ?? []).map((item) => ({
            id: String(item.id),
            title: String(item.title),
            instructions: (item.instructions as string | null) || null,
            frequency: (item.frequency as string | null) || null,
            responsibleRole: (item.responsible_role as string | null) || null,
            goal: String(item.goal),
            proof: item.proof_id
              ? {
                  id: String(item.proof_id),
                  outcome: item.outcome as ProofOutcome,
                  reason: String(item.reason),
                  author: String(item.author),
                  recordedAt: iso(item.recorded_at) ?? "",
                }
              : null,
          })),
        };
      }),
  };
}

const formatDay = (date: string) => date.split("-").reverse().join(".");

// „Alle übrigen wie geplant“ für eine Person und Tageszeit; Abweichungen einzeln mit Grund.
export async function confirmProofs(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const current = await currentSlot(ctx);
  const dayPart = dayPartOf(body.dayPart);
  if (typeof body.date !== "string" || !DATE.test(body.date) || !dayPart)
    throw new ApiError("Bitte Tag und Tageszeit angeben.");
  const date = body.date;
  if (slotOrder(date, dayPart) > slotOrder(current.date, current.dayPart))
    throw new ApiError("Diese Tageszeit hat noch nicht begonnen.");
  const rows = await dueInterventions(ctx, date, dayPart, residentId);
  const open = rows.filter((row) => !row.proof_id);
  if (!rows.length) throw new ApiError("Für diese Tageszeit sind keine Massnahmen geplant.", 404);
  if (!open.length) throw new ApiError("Alle Massnahmen dieser Tageszeit sind bereits nachgewiesen.", 409);

  const deviations = new Map<string, { outcome: Deviation; reason: string }>();
  for (const item of Array.isArray(body.deviations) ? body.deviations : []) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const interventionId = assertUuid(entry.interventionId, "Massnahme");
    if (!open.some((row) => row.id === interventionId))
      throw new ApiError("Diese Massnahme ist nicht offen. Bitte neu laden.", 409);
    const outcome = entry.outcome;
    if (outcome !== "partial" && outcome !== "not_done") throw new ApiError("Bitte die Abweichung wählen.");
    const reason = text(entry.reason, 4000);
    if (reason.length < 3)
      throw new ApiError(
        outcome === "partial"
          ? "Bitte kurz beschreiben, was durchgeführt wurde und was nicht."
          : "Bitte den Grund angeben, warum die Massnahme nicht durchgeführt wurde.",
      );
    deviations.set(interventionId, { outcome, reason });
  }

  const slot = `${DAY_PARTS[dayPart].label}, ${formatDay(date)}`;
  const statements = open.flatMap((row) => {
    const id = randomUUID();
    const deviation = deviations.get(String(row.id));
    const outcome: ProofOutcome = deviation?.outcome ?? "done";
    const entryId = deviation ? randomUUID() : null;
    return [
      ...(deviation
        ? [
            ctx.sql`
              INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body,
                importance, metadata)
              SELECT ${entryId}, ${residentId},
                (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL
                  ORDER BY started_at DESC LIMIT 1),
                ${ctx.actor.id}, 'Pflege', ${String(row.title).slice(0, 220)},
                ${`Massnahme ${PROOF_OUTCOMES[deviation.outcome].toLowerCase()} (${slot}): ${deviation.reason}`},
                'important', ${JSON.stringify({ interventionProofId: id })}::jsonb`,
          ]
        : []),
      ctx.sql`
        INSERT INTO carecore_intervention_proofs (id, organization_id, resident_id, intervention_id, proof_date, day_part,
          outcome, reason, documentation_entry_id, author_user_id)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${row.id}, ${date}::date, ${dayPart}, ${outcome},
          ${deviation?.reason ?? ""}, ${entryId}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "intervention_proof",
        entityId: id,
        action: outcome === "done" ? "created" : "deviation",
        after: { interventionId: row.id, title: row.title, date, dayPart, outcome, reason: deviation?.reason ?? null },
      }),
    ];
  });
  await ctx.sql.transaction(statements).catch((error) => {
    if (String(error).includes("carecore_intervention_proofs_slot_idx"))
      throw new ApiError("Inzwischen wurde bereits nachgewiesen. Bitte neu laden.", 409);
    throw error;
  });
  return { done: open.length - deviations.size, deviations: deviations.size };
}

// Stornieren statt löschen (z. B. falsche Person oder Tageszeit); danach lässt sich neu nachweisen. Ein Eintrag in der
// Pflegedokumentation zu einer Abweichung bleibt bestehen und wird dort korrigiert.
export async function cancelProof(ctx: ApiContext, proofInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const proofId = assertUuid(proofInput, "Nachweis");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [proof] = (await ctx.sql`
    SELECT id, resident_id, cancelled_at FROM carecore_intervention_proofs
    WHERE id = ${proofId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!proof) throw new ApiError("Nachweis nicht gefunden.", 404);
  if (proof.cancelled_at) throw new ApiError("Der Nachweis ist bereits storniert.", 409);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_intervention_proofs SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason} WHERE id = ${proofId} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'PROOF_CANCELLED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(proof.resident_id),
        entityType: "intervention_proof",
        entityId: proofId,
        action: "cancelled",
        after: { reason },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("PROOF_CANCELLED")) throw new ApiError("Der Nachweis ist bereits storniert.", 409);
      throw error;
    });
}
