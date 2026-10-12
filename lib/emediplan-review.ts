import { ApiError, assertResident, type ApiContext, type Row } from "@/lib/api-context";
import { decodeChmed, draftFromPlan } from "@/lib/emediplan";
import type { EmediplanDraft } from "@/lib/emediplan-shared";
import { createOrder, parseOrderInput } from "@/lib/medication-orders";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";

// eMediplan einlesen: Entwurf für die gewählte Person, mit bekannten Zuordnungen (GTIN/Pharmacode) aus dem eigenen
// Präparatestamm. Übernommen wird jede Zeile einzeln durch eine Fachperson mit Medikationsrecht.

function assertManage(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "medication.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

const normalized = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export type EmediplanReading = EmediplanDraft & {
  medications: Array<{ id: string; name: string; strength: string; form: string }>;
};

export async function readEmediplan(ctx: ApiContext, residentInput: unknown, code: unknown): Promise<EmediplanReading> {
  assertManage(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const { version, plan } = decodeChmed(typeof code === "string" ? code : "");
  const draft = draftFromPlan(version, plan);
  const org = ctx.actor.organizationId;
  const [residents, medications] = (await Promise.all([
    ctx.sql`SELECT first_name, last_name, date_of_birth::text AS birth_date FROM carecore_residents WHERE id = ${residentId}`,
    ctx.sql`
      SELECT id, name, COALESCE(strength, '') AS strength, COALESCE(form, '') AS form, gtin, pharmacode
      FROM carecore_medications WHERE organization_id = ${org} ORDER BY lower(name), strength LIMIT 2000`,
  ])) as Row[][];
  const resident = residents[0];
  const mismatch: string[] = [];
  if (
    draft.patient.lastName &&
    (normalized(draft.patient.lastName) !== normalized(String(resident.last_name)) ||
      (draft.patient.firstName && normalized(draft.patient.firstName) !== normalized(String(resident.first_name))))
  )
    mismatch.push(
      `Name im Plan: ${[draft.patient.firstName, draft.patient.lastName].filter(Boolean).join(" ")}, in der Akte: ${resident.first_name} ${resident.last_name}`,
    );
  if (draft.patient.birthDate && resident.birth_date && draft.patient.birthDate !== resident.birth_date)
    mismatch.push(`Geburtsdatum im Plan: ${draft.patient.birthDate}, in der Akte: ${resident.birth_date}`);
  const lines = draft.lines.map((line) => {
    const known =
      line.idType === 2
        ? medications.find((item) => item.gtin === line.id)
        : line.idType === 3
          ? medications.find((item) => item.pharmacode === line.id)
          : null;
    return {
      ...line,
      match: known
        ? { id: String(known.id), name: String(known.name), strength: String(known.strength), form: String(known.form) }
        : null,
    };
  });
  // Protokoll: der Plan wurde für diese Person gelesen (ohne Inhalt der Medikation).
  await ctx.sql.transaction([
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident",
      entityId: residentId,
      action: "emediplan_read",
      after: { version, issuedAt: draft.issuedAt, lines: lines.length, patientMismatch: mismatch.length > 0 },
    }),
  ]);
  return {
    ...draft,
    patientMismatch: mismatch,
    lines,
    medications: medications.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      strength: String(item.strength),
      form: String(item.form),
    })),
  };
}

// Eine Zeile als Verordnung übernehmen (dieselben Pflichtangaben wie im Medikamentenplan) und die Kennung des Plans
// beim Präparat merken.
export async function adoptEmediplanLine(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const input = parseOrderInput(body);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const idType = Number(body.idType);
  if (idType === 2 && code && !/^\d{8,14}$/.test(code)) throw new ApiError("GTIN ist ungültig.");
  if (idType === 3 && code && !/^\d{1,10}$/.test(code)) throw new ApiError("Pharmacode ist ungültig.");
  const id = await createOrder(ctx, body.residentId, input);
  if (code && (idType === 2 || idType === 3)) {
    await ctx.sql`
      UPDATE carecore_medications m SET
        gtin = CASE WHEN ${idType} = 2 THEN ${code} ELSE m.gtin END,
        pharmacode = CASE WHEN ${idType} = 3 THEN ${code} ELSE m.pharmacode END,
        updated_at = NOW()
      FROM carecore_medication_orders o
      WHERE o.id = ${id} AND m.id = o.medication_id AND m.organization_id = ${ctx.actor.organizationId}`;
  }
  return { id };
}
