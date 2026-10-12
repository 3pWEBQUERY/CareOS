import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  DIAGNOSIS_KINDS,
  DIAGNOSIS_STATUSES,
  ICD_CODE,
  type Diagnosis,
  type DiagnosisKind,
  type DiagnosisList,
  type DiagnosisStatus,
} from "@/lib/diagnoses-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

const toDiagnosis = (row: Row): Diagnosis => ({
  id: String(row.id),
  label: String(row.label),
  icdCode: String(row.icd_code),
  kind: row.kind as DiagnosisKind,
  sinceOn: (row.since_day as string | null) ?? null,
  source: String(row.source),
  status: row.status as DiagnosisStatus,
  resolvedOn: (row.resolved_day as string | null) ?? null,
  note: String(row.note),
  updatedAt: iso(row.updated_at) ?? "",
  updatedBy: (row.updated_by_name as string | null) ?? null,
});

// Aktuelle zuerst (Hauptdiagnosen vor Nebendiagnosen), danach abgeschlossene.
export async function readDiagnoses(ctx: ApiContext, residentId: string) {
  const rows = (await ctx.sql`
    SELECT d.*, to_char(d.since_on, 'YYYY-MM-DD') AS since_day, to_char(d.resolved_on, 'YYYY-MM-DD') AS resolved_day,
      u.display_name AS updated_by_name
    FROM carecore_resident_diagnoses d LEFT JOIN carecore_users u ON u.id = COALESCE(d.updated_by, d.created_by)
    WHERE d.resident_id = ${residentId}
    ORDER BY d.status = 'resolved', d.kind = 'secondary', d.since_on NULLS LAST, d.created_at`) as Row[];
  return rows.map(toDiagnosis);
}

export async function diagnosisList(ctx: ApiContext, residentInput: unknown): Promise<DiagnosisList> {
  const residentId = await assertResident(ctx, residentInput);
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    diagnoses: await readDiagnoses(ctx, residentId),
  };
}

async function parse(ctx: ApiContext, body: Record<string, unknown>) {
  const label = text(body.label, 200);
  if (!label) throw new ApiError("Bitte die Diagnose angeben.");
  const icdCode = text(body.icdCode, 12).toUpperCase().replace(/\s+/g, "");
  if (icdCode && !ICD_CODE.test(icdCode))
    throw new ApiError("Der ICD-10-Code hat nicht die übliche Form (z. B. F03 oder I63.5).");
  const kind = String(body.kind ?? "secondary");
  if (!(kind in DIAGNOSIS_KINDS)) throw new ApiError("Bitte Haupt- oder Nebendiagnose wählen.");
  const status = String(body.status ?? "current");
  if (!(status in DIAGNOSIS_STATUSES)) throw new ApiError("Bitte den Status wählen.");
  const day = (value: unknown, label: string) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || !DATE.test(value)) throw new ApiError(`${label} ist ungültig.`);
    return value;
  };
  const sinceOn = day(body.sinceOn, "Das Datum „seit“");
  const resolvedOn = status === "resolved" ? day(body.resolvedOn, "Das Datum „abgeschlossen am“") : null;
  const [today] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  for (const [value, label] of [
    [sinceOn, "Das Datum „seit“"],
    [resolvedOn, "Das Datum „abgeschlossen am“"],
  ] as const)
    if (value && value > String(today.day)) throw new ApiError(`${label} liegt in der Zukunft.`);
  if (sinceOn && resolvedOn && resolvedOn < sinceOn)
    throw new ApiError("„Abgeschlossen am“ liegt vor dem Datum „seit“.");
  return {
    label,
    icdCode,
    kind: kind as DiagnosisKind,
    sinceOn,
    source: text(body.source, 200),
    status: status as DiagnosisStatus,
    resolvedOn,
    note: text(body.note, 2000),
  };
}

export async function createDiagnosis(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const data = await parse(ctx, body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_diagnoses (id, organization_id, resident_id, label, icd_code, kind, since_on, source,
        status, resolved_on, note, created_by, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${data.label}, ${data.icdCode}, ${data.kind},
        ${data.sinceOn}, ${data.source}, ${data.status}, ${data.resolvedOn}, ${data.note}, ${ctx.actor.id}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_diagnosis",
      entityId: id,
      action: "created",
      after: data,
    }),
  ]);
  return diagnosisList(ctx, residentId);
}

async function loadDiagnosis(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Diagnose");
  const [row] = (await ctx.sql`
    SELECT d.*, to_char(d.since_on, 'YYYY-MM-DD') AS since_day, to_char(d.resolved_on, 'YYYY-MM-DD') AS resolved_day,
      d.updated_at::text AS stamp
    FROM carecore_resident_diagnoses d WHERE d.id = ${id} AND d.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Diagnose nicht gefunden.", 404);
  return row;
}

const snapshot = (row: Row) => {
  const diagnosis = toDiagnosis(row);
  return {
    label: diagnosis.label,
    icdCode: diagnosis.icdCode,
    kind: diagnosis.kind,
    sinceOn: diagnosis.sinceOn,
    source: diagnosis.source,
    status: diagnosis.status,
    resolvedOn: diagnosis.resolvedOn,
    note: diagnosis.note,
  };
};

// Ändern nur, wenn seit dem Öffnen niemand anderes geändert hat ({ updatedAt } aus der Liste).
export async function updateDiagnosis(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const row = await loadDiagnosis(ctx, idInput);
  const id = String(row.id);
  const residentId = String(row.resident_id);
  const data = await parse(ctx, body);
  const before = snapshot(row);
  const conflict = () => new ApiError("Die Diagnose wurde inzwischen geändert. Bitte neu laden.", 409);
  if (typeof body.updatedAt === "string" && body.updatedAt !== iso(row.updated_at)) throw conflict();
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_resident_diagnoses SET label = ${data.label}, icd_code = ${data.icdCode}, kind = ${data.kind},
            since_on = ${data.sinceOn}, source = ${data.source}, status = ${data.status}, resolved_on = ${data.resolvedOn},
            note = ${data.note}, updated_by = ${ctx.actor.id}, updated_at = NOW()
          WHERE id = ${id} AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'DIAGNOSIS_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "resident_diagnosis",
        entityId: id,
        action: "updated",
        before,
        after: data,
      }),
    ])
    .catch((error) => {
      if (String(error).includes("DIAGNOSIS_CHANGED")) throw conflict();
      throw error;
    });
  return diagnosisList(ctx, residentId);
}

// Entfernen nur für Fehleinträge (falsche Person, doppelt); eine überholte Diagnose wird abgeschlossen.
export async function deleteDiagnosis(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const reason = text(body.reason, 500);
  if (!reason) throw new ApiError("Bitte angeben, warum der Eintrag entfernt wird.");
  const row = await loadDiagnosis(ctx, idInput);
  const residentId = String(row.resident_id);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_resident_diagnoses WHERE id = ${row.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_diagnosis",
      entityId: String(row.id),
      action: "deleted",
      before: snapshot(row),
      after: { reason },
    }),
  ]);
  return diagnosisList(ctx, residentId);
}
