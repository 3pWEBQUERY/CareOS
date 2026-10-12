import { randomUUID } from "node:crypto";
import { kompassStatus } from "@/lib/kompass";
import { readTerms } from "@/lib/settings";
import {
  ApiError,
  assertResident,
  assertUuid,
  iso,
  text,
  auditStatement,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { staffOf } from "@/lib/care-planning";
import { storeFile } from "@/lib/files";
import { listRound } from "@/lib/medication-round";
import { ROUNDS, type RoundKey } from "@/lib/medication-shared";
import {
  LANGUAGES,
  MARITAL_STATUSES,
  RELIGIONS,
  RESIDENT_DOCUMENT_CATEGORIES,
  RESIDENT_FILE_TYPES,
  RESUSCITATION_STATUSES,
  type MasterData,
  type RecordSummary,
  type ResidentFile,
  type TimelineEntry,
} from "@/lib/resident-record-shared";
import { hasPermission } from "@/lib/server-data";
import { auditOrigin } from "@/lib/audit-origin";
import { insuranceNumberError, socialNumberError } from "@/lib/country";
import { organizationCountry } from "@/lib/organization-country";
import { readInsurers } from "@/lib/insurers";
import { isRepresentativeRole, type AdvanceAnswer } from "@/lib/advance-care-shared";
import { EVACUATION_MOBILITY } from "@/lib/evacuation-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function medsToday(ctx: ApiContext, residentId: string) {
  const rounds = await Promise.all((Object.keys(ROUNDS) as RoundKey[]).map((round) => listRound(ctx, round, null)));
  const doses = rounds.flatMap((round) => round.doses).filter((dose) => dose.residentId === residentId);
  return { given: doses.filter((dose) => dose.status === "administered").length, total: doses.length };
}

// Master data, key figures and completeness of the record.
// Das Änderungsprotokoll der Akte sieht nur die Leitung.
export function canViewResidentAudit(actor: Parameters<typeof hasPermission>[0]) {
  return hasPermission(actor, "team.manage") || hasPermission(actor, "administration.manage");
}

export async function recordSummary(ctx: ApiContext, residentIdInput: unknown): Promise<RecordSummary> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [rows, vitals, documents, meds, staff, kompass] = await Promise.all([
    ctx.sql`
      SELECT r.*, to_char(r.date_of_birth, 'YYYY-MM-DD') AS birth_day, to_char(r.admitted_on, 'YYYY-MM-DD') AS admitted_day,
        to_char(r.resuscitation_decided_on, 'YYYY-MM-DD') AS resuscitation_day,
        to_char(r.advance_directive_on, 'YYYY-MM-DD') AS advance_directive_day,
        to_char(r.care_mandate_on, 'YYYY-MM-DD') AS care_mandate_day,
        to_char(r.care_mandate_effective_on, 'YYYY-MM-DD') AS care_mandate_effective_day,
        rep.full_name AS representative_name, rep.representative_role, rep.phone AS representative_phone,
        nurse.display_name AS nurse_name, checker.display_name AS checker_name,
        plan.care_level, owner.display_name AS plan_owner,
        EXISTS (SELECT 1 FROM carecore_resident_contacts c WHERE c.resident_id = r.id AND c.is_emergency_contact) AS has_emergency_contact,
        EXISTS (SELECT 1 FROM carecore_resident_biographies b WHERE b.resident_id = r.id AND b.life_story <> '') AS has_biography
      FROM carecore_residents r
      LEFT JOIN carecore_users nurse ON nurse.id = r.primary_care_user_id
      LEFT JOIN carecore_users checker ON checker.id = r.master_data_checked_by
      LEFT JOIN LATERAL (SELECT care_level, owner_user_id FROM carecore_care_plans
        WHERE resident_id = r.id AND status IN ('draft', 'active', 'review') LIMIT 1) plan ON TRUE
      LEFT JOIN carecore_users owner ON owner.id = plan.owner_user_id
      LEFT JOIN LATERAL (SELECT full_name, representative_role, phone FROM carecore_resident_contacts c
        WHERE c.resident_id = r.id AND c.representative_role IS NOT NULL
        ORDER BY array_position(ARRAY['mandate', 'official', 'spouse', 'relative', 'other']::varchar[], c.representative_role),
          c.is_primary DESC, c.full_name
        LIMIT 1) rep ON TRUE
      WHERE r.id = ${residentId}` as Promise<Row[]>,
    ctx.sql`
      SELECT measured_at, metric, status FROM carecore_vital_measurements
      WHERE resident_id = ${residentId} ORDER BY measured_at DESC LIMIT 1` as Promise<Row[]>,
    ctx.sql`
      SELECT COUNT(*)::int AS n FROM carecore_documents
      WHERE resident_id = ${residentId} AND organization_id = ${ctx.actor.organizationId} AND status <> 'archived'` as Promise<
      Row[]
    >,
    medsToday(ctx, residentId),
    staffOf(ctx),
    kompassStatus(ctx, residentId),
  ]);
  const r = rows[0];
  const master: MasterData = {
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    dateOfBirth: (r.birth_day as string | null) ?? null,
    gender: String(r.gender ?? "unspecified"),
    maritalStatus: (r.marital_status as string | null) ?? null,
    language: String(r.language ?? "de-CH"),
    socialSecurityNumber: (r.social_security_number as string | null) ?? null,
    religion: (r.religion as string | null) ?? null,
    externalNumber: (r.external_number as string | null) ?? null,
    admittedOn: (r.admitted_day as string | null) ?? null,
    admissionReason: (r.admission_reason as string | null) ?? null,
    primaryNurseId: (r.primary_care_user_id as string | null) ?? null,
    gpName: (r.gp_name as string | null) ?? null,
    gpPractice: (r.gp_practice as string | null) ?? null,
    gpPhone: (r.gp_phone as string | null) ?? null,
    pharmacy: (r.pharmacy as string | null) ?? null,
    insurer: (r.insurer as string | null) ?? null,
    insuranceNumber: (r.insurance_number as string | null) ?? null,
    resuscitationStatus: (r.resuscitation_status as MasterData["resuscitationStatus"]) ?? null,
    resuscitationSource: (r.resuscitation_source as string | null) ?? null,
    resuscitationDecidedOn: (r.resuscitation_day as string | null) ?? null,
    advanceDirective: (r.advance_directive as AdvanceAnswer | null) ?? null,
    advanceDirectiveOn: (r.advance_directive_day as string | null) ?? null,
    advanceDirectiveLocation: (r.advance_directive_location as string | null) ?? null,
    careMandate: (r.care_mandate as AdvanceAnswer | null) ?? null,
    careMandateOn: (r.care_mandate_day as string | null) ?? null,
    careMandateEffectiveOn: (r.care_mandate_effective_day as string | null) ?? null,
    evacuationMobility: (r.evacuation_mobility as MasterData["evacuationMobility"]) ?? null,
    evacuationNote: (r.evacuation_note as string | null) ?? null,
  };
  const missing = [
    !master.resuscitationStatus && "Reanimationsstatus",
    !master.advanceDirective && "Patientenverfügung",
    !master.dateOfBirth && "Geburtsdatum",
    !master.admittedOn && "Eintrittsdatum",
    !master.primaryNurseId && "Bezugspflege",
    !master.gpName && "Hausarzt",
    !r.has_emergency_contact && "Notfallkontakt",
    !r.medication_allergies && "Allergien",
    !r.has_biography && "Biografie",
  ].filter((item): item is string => Boolean(item));
  const vital = vitals[0];
  return {
    master,
    primaryNurse: (r.nurse_name as string | null) ?? null,
    planOwner: (r.plan_owner as string | null) ?? null,
    careLevel: (r.care_level as string | null) ?? null,
    checkedAt: iso(r.master_data_checked_at),
    checkedBy: (r.checker_name as string | null) ?? null,
    missing,
    lastVital: vital
      ? { measuredAt: iso(vital.measured_at) ?? "", metric: String(vital.metric), status: String(vital.status) }
      : null,
    medsToday: meds,
    documentsCount: Number(documents[0]?.n ?? 0),
    staff,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    canViewAudit: canViewResidentAudit(ctx.actor),
    canExport: hasPermission(ctx.actor, "administration.manage"),
    representative: isRepresentativeRole(r.representative_role)
      ? {
          name: String(r.representative_name),
          role: r.representative_role,
          phone: (r.representative_phone as string | null) ?? null,
        }
      : null,
    kompass,
  };
}

const optional = (value: unknown, max: number) => text(value, max) || null;

export async function updateMasterData(ctx: ApiContext, residentIdInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentIdInput);
  const firstName = text(body.firstName, 100);
  const lastName = text(body.lastName, 100);
  if (!firstName || !lastName) throw new ApiError("Vor- und Nachname sind Pflichtfelder.");
  const dateOf = (value: unknown, label: string) => {
    if (!value) return null;
    if (typeof value !== "string" || !DATE.test(value)) throw new ApiError(`${label} ist ungültig.`);
    return value;
  };
  const gender = ["male", "female", "diverse", "unspecified"].includes(String(body.gender))
    ? String(body.gender)
    : "unspecified";
  const maritalStatus = body.maritalStatus ? String(body.maritalStatus) : null;
  if (maritalStatus && !MARITAL_STATUSES.includes(maritalStatus)) throw new ApiError("Ungültiger Zivilstand.");
  const language = String(body.language ?? "de-CH") in LANGUAGES ? String(body.language ?? "de-CH") : "de-CH";
  const ssn = optional(body.socialSecurityNumber, 20);
  const resuscitationStatus = body.resuscitationStatus ? String(body.resuscitationStatus) : null;
  if (resuscitationStatus && !(resuscitationStatus in RESUSCITATION_STATUSES))
    throw new ApiError("Ungültiger Reanimationsstatus.");
  const resuscitationSource = resuscitationStatus ? optional(body.resuscitationSource, 200) : null;
  if (resuscitationStatus && !resuscitationSource)
    throw new ApiError("Bitte die Grundlage des Reanimationsstatus angeben (z. B. Patientenverfügung).");
  const answer = (value: unknown) => (value === "yes" || value === "no" ? value : null);
  const advanceDirective = answer(body.advanceDirective);
  const careMandate = answer(body.careMandate);
  const evacuationMobility = body.evacuationMobility ? String(body.evacuationMobility) : null;
  if (evacuationMobility && !(evacuationMobility in EVACUATION_MOBILITY))
    throw new ApiError("Ungültige Angabe zur Mobilität im Notfall.");
  let nurseId: string | null = null;
  if (body.primaryNurseId) {
    nurseId = assertUuid(body.primaryNurseId, "Bezugspflege");
    const staff =
      await ctx.sql`SELECT 1 FROM carecore_user_profiles WHERE user_id = ${nurseId} AND organization_id = ${ctx.actor.organizationId}`;
    if (!staff[0]) throw new ApiError("Die Bezugspflege gehört nicht zu dieser Organisation.");
  }
  // Zimmerwechsel (auch in einen anderen Wohnbereich): Auswahl aus den Zimmern, die die Administration unter Belegung
  // anlegt. Der bisherige Aufenthalt endet jetzt, der neue beginnt; beides bleibt im Verlauf.
  let roomMove: { stayId: string; from: Row; room: Row } | null = null;
  if (body.roomId) {
    const roomId = assertUuid(body.roomId, "Zimmer");
    const [stay] = (await ctx.sql`
      SELECT r.status, st.id, st.room_id, st.care_unit_id FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT id, room_id, care_unit_id FROM carecore_resident_stays
        WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
      WHERE r.id = ${residentId}`) as Row[];
    if (stay?.room_id !== roomId) {
      if (!stay?.id || !["active", "planned"].includes(String(stay.status)))
        throw new ApiError("Ein Zimmerwechsel ist nur während eines laufenden Aufenthalts möglich.");
      const [room] = (await ctx.sql`
        SELECT ro.id, ro.name, ro.care_unit_id, ro.beds,
          (SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
            WHERE st.room_id = ro.id AND st.ended_at IS NULL AND r.status IN ('active', 'planned')
              AND st.resident_id <> ${residentId})::int AS occupied
        FROM carecore_rooms ro JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
        WHERE ro.id = ${roomId} AND s.organization_id = ${ctx.actor.organizationId} AND ro.active AND cu.active`) as Row[];
      if (!room) throw new ApiError("Zimmer nicht gefunden. Zimmer legt die Administration unter „Belegung“ an.");
      if (Number(room.occupied) >= Number(room.beds))
        throw new ApiError(`In ${String(room.name)} ist kein Bett mehr frei.`, 409);
      roomMove = { stayId: String(stay.id), from: stay, room };
    }
  }
  const data = {
    firstName,
    lastName,
    dateOfBirth: dateOf(body.dateOfBirth, "Geburtsdatum"),
    gender,
    maritalStatus,
    language,
    socialSecurityNumber: ssn,
    religion: optional(body.religion, 80),
    externalNumber: optional(body.externalNumber, 80),
    admittedOn: dateOf(body.admittedOn, "Eintrittsdatum"),
    admissionReason: optional(body.admissionReason, 160),
    primaryNurseId: nurseId,
    gpName: optional(body.gpName, 160),
    gpPractice: optional(body.gpPractice, 200),
    gpPhone: optional(body.gpPhone, 60),
    pharmacy: optional(body.pharmacy, 200),
    insurer: optional(body.insurer, 160),
    insuranceNumber: optional(body.insuranceNumber, 40),
    resuscitationStatus,
    resuscitationSource,
    resuscitationDecidedOn: resuscitationStatus ? dateOf(body.resuscitationDecidedOn, "Datum des Entscheids") : null,
    advanceDirective,
    advanceDirectiveOn:
      advanceDirective === "yes" ? dateOf(body.advanceDirectiveOn, "Datum der Patientenverfügung") : null,
    advanceDirectiveLocation: advanceDirective === "yes" ? optional(body.advanceDirectiveLocation, 200) : null,
    careMandate,
    careMandateOn: careMandate === "yes" ? dateOf(body.careMandateOn, "Datum des Vorsorgeauftrags") : null,
    careMandateEffectiveOn: careMandate === "yes" ? dateOf(body.careMandateEffectiveOn, "Datum der Wirksamkeit") : null,
    evacuationMobility,
    evacuationNote: optional(body.evacuationNote, 300),
  };
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
  for (const [value, label] of [
    [data.advanceDirectiveOn, "Das Datum der Patientenverfügung"],
    [data.careMandateOn, "Das Datum des Vorsorgeauftrags"],
    [data.careMandateEffectiveOn, "Das Datum der Wirksamkeit"],
  ] as const)
    if (value && value > today) throw new ApiError(`${label} liegt in der Zukunft.`);
  if (
    data.resuscitationDecidedOn &&
    data.resuscitationDecidedOn > new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" })
  )
    throw new ApiError("Das Datum des Entscheids liegt in der Zukunft.");
  const before = (await ctx.sql`
    SELECT *, to_char(resuscitation_decided_on, 'YYYY-MM-DD') AS resuscitation_day,
      to_char(advance_directive_on, 'YYYY-MM-DD') AS advance_directive_day,
      to_char(care_mandate_on, 'YYYY-MM-DD') AS care_mandate_day,
      to_char(care_mandate_effective_on, 'YYYY-MM-DD') AS care_mandate_effective_day
    FROM carecore_residents WHERE id = ${residentId}`) as Row[];
  const b = before[0];
  // Nummern im Format des Landes der Einrichtung; ein unveränderter Wert (z. B. aus der Zeit vor einem Wechsel des
  // Landes) bleibt gültig.
  const country = await organizationCountry(ctx);
  const ssnError =
    data.socialSecurityNumber && data.socialSecurityNumber !== b.social_security_number
      ? socialNumberError(country, data.socialSecurityNumber)
      : null;
  if (ssnError) throw new ApiError(ssnError);
  const insuranceError =
    data.insuranceNumber && data.insuranceNumber !== b.insurance_number
      ? insuranceNumberError(country, data.insuranceNumber)
      : null;
  if (insuranceError) throw new ApiError(insuranceError);
  if (data.religion && data.religion !== b.religion && !RELIGIONS[country].includes(data.religion))
    throw new ApiError("Bitte eine Konfession aus der Liste wählen.");
  // Versicherung aus der Liste der Einrichtung; ein früher frei erfasster Wert bleibt gültig, solange er unverändert ist.
  if (data.insurer && data.insurer !== b.insurer && !(await readInsurers(ctx)).insurers.includes(data.insurer))
    throw new ApiError("Bitte eine Versicherung aus der Liste wählen. Die Liste verwaltet die Administration.");
  const resuscitationBefore = {
    status: (b.resuscitation_status as string | null) ?? null,
    source: (b.resuscitation_source as string | null) ?? null,
    decidedOn: (b.resuscitation_day as string | null) ?? null,
  };
  const resuscitationAfter = {
    status: data.resuscitationStatus,
    source: data.resuscitationSource,
    decidedOn: data.resuscitationDecidedOn,
  };
  // Der Reanimationsstatus ist ein klinischer Entscheid: jede Änderung erhält einen eigenen Protokolleintrag.
  const resuscitationChanged = JSON.stringify(resuscitationBefore) !== JSON.stringify(resuscitationAfter);
  // Vorsorge ebenso mit eigenem Eintrag.
  const advanceBefore = {
    advanceDirective: (b.advance_directive as string | null) ?? null,
    advanceDirectiveOn: (b.advance_directive_day as string | null) ?? null,
    advanceDirectiveLocation: (b.advance_directive_location as string | null) ?? null,
    careMandate: (b.care_mandate as string | null) ?? null,
    careMandateOn: (b.care_mandate_day as string | null) ?? null,
    careMandateEffectiveOn: (b.care_mandate_effective_day as string | null) ?? null,
  };
  const advanceAfter = {
    advanceDirective: data.advanceDirective,
    advanceDirectiveOn: data.advanceDirectiveOn,
    advanceDirectiveLocation: data.advanceDirectiveLocation,
    careMandate: data.careMandate,
    careMandateOn: data.careMandateOn,
    careMandateEffectiveOn: data.careMandateEffectiveOn,
  };
  const advanceChanged = JSON.stringify(advanceBefore) !== JSON.stringify(advanceAfter);
  // Angaben für Brandfall und Evakuation ebenso.
  const evacuationBefore = {
    evacuationMobility: (b.evacuation_mobility as string | null) ?? null,
    evacuationNote: (b.evacuation_note as string | null) ?? null,
  };
  const evacuationAfter = { evacuationMobility: data.evacuationMobility, evacuationNote: data.evacuationNote };
  const evacuationChanged = JSON.stringify(evacuationBefore) !== JSON.stringify(evacuationAfter);
  try {
    await ctx.sql.transaction([
      ctx.sql`
      UPDATE carecore_residents SET first_name = ${data.firstName}, last_name = ${data.lastName},
        date_of_birth = ${data.dateOfBirth}, gender = ${data.gender}, marital_status = ${data.maritalStatus},
        language = ${data.language}, social_security_number = ${data.socialSecurityNumber}, religion = ${data.religion},
        external_number = ${data.externalNumber}, admitted_on = ${data.admittedOn}, admission_reason = ${data.admissionReason},
        primary_care_user_id = ${data.primaryNurseId}, gp_name = ${data.gpName}, gp_practice = ${data.gpPractice},
        gp_phone = ${data.gpPhone}, pharmacy = ${data.pharmacy}, insurer = ${data.insurer},
        insurance_number = ${data.insuranceNumber}, resuscitation_status = ${data.resuscitationStatus},
        resuscitation_source = ${data.resuscitationSource}, resuscitation_decided_on = ${data.resuscitationDecidedOn},
        advance_directive = ${data.advanceDirective}, advance_directive_on = ${data.advanceDirectiveOn},
        advance_directive_location = ${data.advanceDirectiveLocation}, care_mandate = ${data.careMandate},
        care_mandate_on = ${data.careMandateOn}, care_mandate_effective_on = ${data.careMandateEffectiveOn},
        evacuation_mobility = ${data.evacuationMobility}, evacuation_note = ${data.evacuationNote},
        master_data_checked_at = NOW(), master_data_checked_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${residentId}`,
      auditStatement(
        ctx,
        "resident",
        residentId,
        "master_data_updated",
        { firstName: b.first_name, lastName: b.last_name, primaryNurseId: b.primary_care_user_id, gpName: b.gp_name },
        // Social security and insurance numbers are not written to the audit trail.
        {
          ...data,
          socialSecurityNumber: data.socialSecurityNumber ? "geändert" : null,
          insuranceNumber: data.insuranceNumber ? "geändert" : null,
        },
      ),
      ...(resuscitationChanged
        ? [
            auditStatement(
              ctx,
              "resident",
              residentId,
              "resuscitation_updated",
              resuscitationBefore,
              resuscitationAfter,
            ),
          ]
        : []),
      ...(advanceChanged
        ? [auditStatement(ctx, "resident", residentId, "advance_care_updated", advanceBefore, advanceAfter)]
        : []),
      ...(evacuationChanged
        ? [auditStatement(ctx, "resident", residentId, "evacuation_updated", evacuationBefore, evacuationAfter)]
        : []),
      ...(roomMove
        ? [
            ctx.sql`
              WITH changed AS (
                UPDATE carecore_resident_stays SET ended_at = GREATEST(started_at, NOW())
                WHERE id = ${roomMove.stayId} AND ended_at IS NULL RETURNING id)
              SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'STAY_CHANGED')`,
            ctx.sql`
              INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id, started_at, created_by)
              VALUES (${randomUUID()}, ${residentId}, ${roomMove.room.care_unit_id}, ${roomMove.room.id}, NOW(), ${ctx.actor.id})`,
            auditStatement(
              ctx,
              "resident",
              residentId,
              "room_changed",
              { roomId: roomMove.from.room_id ?? null, careUnitId: roomMove.from.care_unit_id ?? null },
              { roomId: roomMove.room.id, careUnitId: roomMove.room.care_unit_id, room: roomMove.room.name },
            ),
          ]
        : []),
    ]);
  } catch (error) {
    if (String(error).includes("external_number"))
      throw new ApiError(`Diese ${(await readTerms(ctx)).prefix}nummer ist bereits vergeben.`, 409);
    if (String(error).includes("STAY_CHANGED"))
      throw new ApiError("Der Aufenthalt wurde inzwischen geändert. Bitte die Akte neu laden.", 409);
    throw error;
  }
}

const IMPORTANCE_TONES: Record<string, TimelineEntry["tone"]> = {
  critical: "critical",
  important: "attention",
  observation: "attention",
  visit: "info",
};
const ADMINISTRATION_LABELS: Record<string, string> = {
  administered: "verabreicht",
  declined: "abgelehnt",
  omitted: "ausgelassen",
  delayed: "verschoben",
};

// Documentation, vital signs, medication and appointments of the last 60 days in one list.
export async function recordTimeline(ctx: ApiContext, residentIdInput: unknown): Promise<TimelineEntry[]> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [docs, vitals, meds, appointments] = (await Promise.all([
    ctx.sql`
      SELECT d.id, d.title, d.category, d.body, d.importance, d.occurred_at,
        COALESCE(u.display_name, d.metadata ->> 'portalAuthor') AS author
      FROM carecore_documentation_entries d LEFT JOIN carecore_users u ON u.id = d.author_user_id
      WHERE d.resident_id = ${residentId} AND d.occurred_at > NOW() - INTERVAL '60 days'
      ORDER BY d.occurred_at DESC LIMIT 150`,
    ctx.sql`
      SELECT v.id, v.metric, v.value, v.secondary_value, v.unit, v.status, v.note, v.measured_at, u.display_name AS author
      FROM carecore_vital_measurements v LEFT JOIN carecore_users u ON u.id = v.measured_by
      WHERE v.resident_id = ${residentId} AND v.measured_at > NOW() - INTERVAL '60 days'
      ORDER BY v.measured_at DESC LIMIT 150`,
    ctx.sql`
      SELECT a.id, a.status, a.note, COALESCE(a.administered_at, a.updated_at) AS at,
        TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication, o.is_prn, u.display_name AS author
      FROM carecore_medication_administrations a
      JOIN carecore_medication_orders o ON o.id = a.medication_order_id
      LEFT JOIN carecore_medications m ON m.id = o.medication_id
      LEFT JOIN carecore_users u ON u.id = a.administered_by
      WHERE a.resident_id = ${residentId} AND a.status <> 'scheduled'
        AND COALESCE(a.administered_at, a.updated_at) > NOW() - INTERVAL '60 days'
      ORDER BY at DESC LIMIT 150`,
    ctx.sql`
      SELECT a.id, a.title, a.category, a.location, a.notes, a.status, a.starts_at, u.display_name AS author
      FROM carecore_resident_appointments a LEFT JOIN carecore_users u ON u.id = a.created_by
      WHERE a.resident_id = ${residentId} AND a.starts_at > NOW() - INTERVAL '60 days' AND a.starts_at < NOW() + INTERVAL '14 days'
      ORDER BY a.starts_at DESC LIMIT 100`,
  ])) as Row[][];
  const number = (value: unknown) => Number(value).toLocaleString("de-CH", { maximumFractionDigits: 1 });
  const entries: TimelineEntry[] = [
    ...docs.map((row) => ({
      id: `doc-${row.id}`,
      // Einträge der Kategorien Medikation und Vitalwerte erscheinen auch unter diesen Filtern im Verlauf.
      category: (row.category === "Medikation" || row.category === "Vitalwerte" ? row.category : "Pflege") as
        "Pflege" | "Medikation" | "Vitalwerte",
      occurredAt: iso(row.occurred_at) ?? "",
      title: String(row.title ?? row.category),
      description: String(row.body),
      author: (row.author as string | null) ?? null,
      tone: IMPORTANCE_TONES[String(row.importance)] ?? "stable",
      documentationId: String(row.id),
    })),
    ...vitals.map((row) => ({
      id: `vital-${row.id}`,
      category: "Vitalwerte" as const,
      occurredAt: iso(row.measured_at) ?? "",
      title: String(row.metric),
      description: `${number(row.value)}${row.secondary_value !== null ? `/${number(row.secondary_value)}` : ""} ${row.unit}${row.note ? ` · ${row.note}` : ""}`,
      author: (row.author as string | null) ?? null,
      tone: (row.status === "critical"
        ? "critical"
        : row.status === "attention"
          ? "attention"
          : "stable") as TimelineEntry["tone"],
      documentationId: null,
    })),
    ...meds.map((row) => ({
      id: `med-${row.id}`,
      category: "Medikation" as const,
      occurredAt: iso(row.at) ?? "",
      title: `${row.medication || "Medikament"} ${ADMINISTRATION_LABELS[String(row.status)] ?? String(row.status)}`,
      description: `${row.is_prn ? "Reservegabe" : "Geplante Gabe"}${row.note ? ` · ${row.note}` : ""}`,
      author: (row.author as string | null) ?? null,
      tone: (row.status === "administered" ? "stable" : "attention") as TimelineEntry["tone"],
      documentationId: null,
    })),
    ...appointments.map((row) => ({
      id: `appointment-${row.id}`,
      category: "Termine" as const,
      occurredAt: iso(row.starts_at) ?? "",
      title: String(row.title),
      description: [row.category, row.location, row.status === "cancelled" ? "abgesagt" : null, row.notes]
        .filter(Boolean)
        .join(" · "),
      author: (row.author as string | null) ?? null,
      tone: (row.status === "cancelled" ? "attention" : "info") as TimelineEntry["tone"],
      documentationId: null,
    })),
  ];
  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function mapFile(row: Row): ResidentFile {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category ?? "Administration"),
    description: (row.description as string | null) ?? null,
    fileId: (row.file_id as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    createdAt: iso(row.created_at) ?? "",
    uploadedBy: (row.uploaded_by_name as string | null) ?? null,
  };
}

export async function residentFiles(ctx: ApiContext, residentIdInput: unknown) {
  const residentId = await assertResident(ctx, residentIdInput);
  const rows = (await ctx.sql`
    SELECT d.*, u.display_name AS uploaded_by_name FROM carecore_documents d
    LEFT JOIN carecore_users u ON u.id = d.uploaded_by
    WHERE d.resident_id = ${residentId} AND d.organization_id = ${ctx.actor.organizationId} AND d.status <> 'archived'
    ORDER BY d.created_at DESC`) as Row[];
  return rows.map(mapFile);
}

export async function uploadResidentFile(ctx: ApiContext, residentIdInput: unknown, form: FormData) {
  const residentId = await assertResident(ctx, residentIdInput);
  const title = text(form.get("title"), 220);
  if (title.length < 3) throw new ApiError("Bitte einen Titel mit mindestens 3 Zeichen angeben.");
  const category = String(form.get("category") ?? "");
  if (!(RESIDENT_DOCUMENT_CATEGORIES as readonly string[]).includes(category))
    throw new ApiError("Bitte eine Kategorie wählen.");
  const file = await storeFile(ctx, form.get("file"), "document", RESIDENT_FILE_TYPES);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_documents (id, organization_id, resident_id, kind, title, category, description, file_id, storage_key,
      mime_type, size_bytes, version, version_no, status, uploaded_by)
    VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, 'document', ${title}, ${category},
      ${text(form.get("description"), 2000) || null}, ${file.id}, ${`cloud:${file.id}`}, ${file.type}, ${file.size}, '1', 1,
      'active', ${ctx.actor.id})`,
    auditStatement(ctx, "resident_document", id, "uploaded", null, {
      residentId,
      title,
      category,
      file: file.name,
    }),
  ]);
  return id;
}

export async function archiveResidentFile(ctx: ApiContext, residentIdInput: unknown, documentIdInput: unknown) {
  const residentId = await assertResident(ctx, residentIdInput);
  const documentId = assertUuid(documentIdInput, "Dokument");
  // Archivieren und Protokoll in einer Anweisung.
  const rows = await ctx.sql`
    WITH archived AS (
      UPDATE carecore_documents SET status = 'archived', archived_at = NOW(), archived_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${documentId} AND resident_id = ${residentId} AND status <> 'archived' RETURNING id, title),
    logged AS (
      INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
      SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'resident_document', archived.id, 'archived',
        ${JSON.stringify({ residentId })}::jsonb
      FROM archived)
    SELECT title FROM archived`;
  if (!rows[0]) throw new ApiError("Dokument nicht gefunden.", 404);
  return String(rows[0].title);
}
