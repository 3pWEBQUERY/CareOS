import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { readSettings } from "@/lib/settings";
import { restraintLabel, type RestraintKind } from "@/lib/restraints-shared";
import { addMonths, day, orgToday, raiPeople, raiWorkplace } from "@/lib/rai";
import { hasPermission } from "@/lib/server-data";
import { mistralConfigured } from "@/lib/mistral";
import { addGoal, parseGoal } from "@/lib/care-plan-goals";
import { OPEN as OPEN_PLANS, createPlan, today as planToday } from "@/lib/care-planning";
import {
  ITEM_BY_KEY,
  KOMPASS_DOMAINS,
  KOMPASS_INSTRUMENT,
  KOMPASS_NAME,
  NOT_APPLICABLE,
  OCCASIONS,
  PARTICIPANTS,
  SCALES,
  answerRank,
  domainProgress,
  optionLabel,
  emptyKompass,
  kompassProgress,
  validAnswer,
  type ContextKey,
  type DomainNotes,
  type KompassData,
  type KompassItem,
  type Occasion,
} from "@/lib/kompass-instrument";
import type {
  KompassAssessment,
  KompassContext,
  KompassDetail,
  KompassFact,
  KompassReport,
  KompassStatistics,
  KompassStatus,
  KompassStatusSummary,
} from "@/lib/kompass-shared";

// CareOS Kompass: Bedarfsabklärung je Person. Die Fachperson beantwortet die Fragen, entscheidet je Bereich über
// den Handlungsbedarf und schliesst ab; CareOS speichert, vergleicht und zeigt Fakten aus der Akte, ohne zu werten.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = ["new", "in_progress", "overdue"];

function readKompass(value: unknown): KompassData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.kompass !== "number") return null;
  const answers: Record<string, string> = {};
  for (const [key, answer] of Object.entries((data.answers ?? {}) as Record<string, unknown>)) {
    const item = ITEM_BY_KEY.get(key);
    if (item && validAnswer(item, answer)) answers[key] = answer as string;
  }
  const domains: Record<string, DomainNotes> = {};
  for (const domain of KOMPASS_DOMAINS) {
    const notes = ((data.domains ?? {}) as Record<string, unknown>)[domain.id];
    if (!notes || typeof notes !== "object") continue;
    domains[domain.id] = cleanNotes(notes as Record<string, unknown>);
    const goalId = (notes as Record<string, unknown>).goalId;
    if (typeof goalId === "string") domains[domain.id].goalId = goalId;
  }
  return {
    kompass: data.kompass,
    occasion: (typeof data.occasion === "string" && data.occasion in OCCASIONS ? data.occasion : "routine") as Occasion,
    assessedOn: typeof data.assessedOn === "string" ? data.assessedOn : "",
    participants: Array.isArray(data.participants)
      ? PARTICIPANTS.filter((participant) => (data.participants as unknown[]).includes(participant))
      : [],
    answers,
    domains,
    summary: typeof data.summary === "string" ? data.summary : "",
  };
}

function cleanNotes(input: Record<string, unknown>): DomainNotes {
  const notes: DomainNotes = {};
  for (const key of ["resources", "wishes", "needText", "notes"] as const)
    if (typeof input[key] === "string") notes[key] = text(input[key], 4000);
  if (typeof input.need === "boolean") notes.need = input.need;
  return notes;
}

function mapAssessment(row: Row): KompassAssessment {
  const kompass = readKompass(row.data);
  const data = (row.data && typeof row.data === "object" ? row.data : {}) as Record<string, unknown>;
  const scores = (data.scores && typeof data.scores === "object" ? data.scores : {}) as Record<string, number>;
  return {
    id: String(row.id),
    instrument: String(row.assessment_type),
    status: row.status as KompassStatus,
    dueOn: day(row.due_on),
    progress: Number(row.progress ?? 0),
    assessorId: row.responsible_user_id ? String(row.responsible_user_id) : null,
    assessor: row.assessor ? String(row.assessor) : null,
    completedAt: iso(row.completed_at),
    completedBy: typeof data.completedBy === "string" ? data.completedBy : null,
    updatedAt: iso(row.updated_at) ?? "",
    kompass,
    legacy: kompass
      ? null
      : {
          assessedOn: typeof data.assessedOn === "string" ? data.assessedOn : (day(row.started_at) ?? ""),
          notes: typeof data.notes === "string" ? data.notes : "",
          scores,
        },
  };
}

const formatDay = (value: unknown) => {
  const date = day(value);
  return date ? date.split("-").reverse().join(".") : "";
};

// Fakten aus der Akte je Kompass-Bereich (nur Anzeige, keine Bewertung durch CareOS).
async function kompassContext(ctx: ApiContext, residentId: string, since: string | null): Promise<KompassContext> {
  const sql = ctx.sql;
  const [
    aids,
    falls,
    repositioning,
    nutrition,
    weights,
    elimination,
    medication,
    wounds,
    diagnoses,
    pain,
    restraints,
    activities,
  ] = (await Promise.all([
    sql`SELECT name, marking FROM carecore_resident_belongings
        WHERE resident_id = ${residentId} AND kind = 'aid' AND removed_at IS NULL ORDER BY name`,
    sql`SELECT occurred_at, COALESCE(title, '') AS title, description FROM carecore_quality_events
        WHERE resident_id = ${residentId} AND type = 'Sturz'
          AND occurred_at > COALESCE(${since}::timestamptz, NOW() - INTERVAL '12 months')
        ORDER BY occurred_at DESC LIMIT 5`,
    sql`SELECT interval_minutes FROM carecore_repositioning_plans WHERE resident_id = ${residentId} AND ended_at IS NULL`,
    sql`SELECT diet, texture, assistance, allergies FROM carecore_nutrition_plans
        WHERE resident_id = ${residentId} AND active ORDER BY updated_at DESC LIMIT 1`,
    sql`SELECT value, measured_at FROM carecore_vital_measurements
        WHERE resident_id = ${residentId} AND metric = 'Gewicht' ORDER BY measured_at DESC LIMIT 2`,
    sql`SELECT kind, COUNT(*)::int AS n, MAX(occurred_at) AS last_at FROM carecore_elimination_entries
        WHERE resident_id = ${residentId} AND cancelled_at IS NULL AND occurred_at > NOW() - INTERVAL '7 days'
        GROUP BY kind`,
    sql`SELECT COALESCE(m.name, 'Präparat') AS name, o.is_prn FROM carecore_medication_orders o
        LEFT JOIN carecore_medications m ON m.id = o.medication_id
        WHERE o.resident_id = ${residentId} AND o.status = 'active' ORDER BY o.is_prn, m.name`,
    sql`SELECT title, body_location FROM carecore_wounds WHERE resident_id = ${residentId} AND status <> 'closed'
        AND closed_at IS NULL ORDER BY created_at`,
    sql`SELECT label, kind FROM carecore_resident_diagnoses WHERE resident_id = ${residentId} AND status = 'current'
        ORDER BY kind = 'main' DESC, label`,
    sql`SELECT occurred_at, body FROM carecore_documentation_entries
        WHERE resident_id = ${residentId} AND category = 'Schmerz' ORDER BY occurred_at DESC LIMIT 3`,
    sql`SELECT kind, description, review_on FROM carecore_restraint_measures
        WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY starts_at`,
    sql`SELECT p.status, COUNT(*)::int AS n FROM carecore_activity_participations p
        WHERE p.resident_id = ${residentId} AND p.recorded_at > NOW() - INTERVAL '30 days' GROUP BY p.status`,
  ])) as Row[][];
  const fact = (label: string, detail: string, href: string): KompassFact => ({ label, detail, href });
  const counts = (rows: Row[], key: string) =>
    Number(rows.find((row) => row.kind === key || row.status === key)?.n ?? 0);
  const regular = medication.filter((row) => !row.is_prn);
  const prn = medication.filter((row) => row.is_prn);
  const context: KompassContext = {
    aids: aids.map((row) => fact(String(row.name), String(row.marking), "/c/bewohner")),
    falls: falls.map((row) =>
      fact(
        `Sturz am ${formatDay(row.occurred_at)}`,
        String(row.title || row.description).slice(0, 160),
        "/c/leitung/qualitaet",
      ),
    ),
    repositioning: repositioning.map((row) =>
      fact(
        "Lagerungsplan läuft",
        `Wechsel alle ${Number(row.interval_minutes)} Minuten`,
        "/c/pflegedokumentation/lagerung",
      ),
    ),
    nutrition: nutrition.map((row) =>
      fact(
        "Ernährungsplan",
        [row.diet, row.texture, row.assistance, row.allergies ? `Allergien: ${row.allergies}` : ""]
          .filter(Boolean)
          .join(" · ") || "ohne weitere Angaben",
        "/c/ernaehrung",
      ),
    ),
    weight: weights.map((row) =>
      fact(
        `Gewicht ${Number(row.value).toLocaleString("de-CH")} kg`,
        `gemessen am ${formatDay(row.measured_at)}`,
        "/c/vitalwerte",
      ),
    ),
    elimination: elimination.length
      ? [
          fact(
            "Ausscheidungsprotokoll, letzte 7 Tage",
            [
              counts(elimination, "stool") ? `Stuhlgang ${counts(elimination, "stool")}×` : "",
              counts(elimination, "incontinence_urine")
                ? `Urinverlust ${counts(elimination, "incontinence_urine")}×`
                : "",
              counts(elimination, "incontinence_stool")
                ? `Stuhlverlust ${counts(elimination, "incontinence_stool")}×`
                : "",
              counts(elimination, "material") ? `Materialwechsel ${counts(elimination, "material")}×` : "",
            ]
              .filter(Boolean)
              .join(" · ") || "Einträge vorhanden",
            "/c/pflegedokumentation/ausscheidung",
          ),
        ]
      : [],
    medication: [
      ...(regular.length
        ? [
            fact(
              `${regular.length} laufende Verordnung${regular.length === 1 ? "" : "en"}`,
              regular
                .slice(0, 8)
                .map((row) => String(row.name))
                .join(", "),
              "/c/medikation",
            ),
          ]
        : []),
      ...(prn.length
        ? [
            fact(
              `${prn.length} Reserve${prn.length === 1 ? "" : "n"}`,
              prn
                .slice(0, 8)
                .map((row) => String(row.name))
                .join(", "),
              "/c/medikation/reserven",
            ),
          ]
        : []),
    ],
    wounds: wounds.map((row) => fact(String(row.title), String(row.body_location), "/c/wundmanagement")),
    diagnoses: diagnoses.map((row) =>
      fact(String(row.label), row.kind === "main" ? "Hauptdiagnose" : "Nebendiagnose", "/c/bewohner"),
    ),
    pain: pain.map((row) =>
      fact(
        `Eintrag „Schmerz“ vom ${formatDay(row.occurred_at)}`,
        String(row.body).slice(0, 160),
        "/c/pflegedokumentation/verlauf",
      ),
    ),
    restraints: restraints.map((row) =>
      fact(
        restraintLabel({ kind: row.kind as RestraintKind, description: String(row.description) }),
        `nächste Überprüfung am ${formatDay(row.review_on)}`,
        "/c/bewohner",
      ),
    ),
    activities: activities.length
      ? [
          fact(
            "Angebote der letzten 30 Tage",
            [
              counts(activities, "participated") ? `teilgenommen ${counts(activities, "participated")}×` : "",
              counts(activities, "declined") ? `abgelehnt ${counts(activities, "declined")}×` : "",
              counts(activities, "absent") ? `nicht anwesend ${counts(activities, "absent")}×` : "",
            ]
              .filter(Boolean)
              .join(" · "),
            "/c/alltag/teilnahme",
          ),
        ]
      : [],
  };
  return context satisfies Record<ContextKey, KompassFact[]>;
}

async function kompassSettings(ctx: ApiContext) {
  const settings = await readSettings(ctx);
  const value = (key: "kompassAdmissionDays" | "kompassIntervalMonths") =>
    settings[key].enabled && settings[key].value ? settings[key].value : null;
  return { admissionDays: value("kompassAdmissionDays"), intervalMonths: value("kompassIntervalMonths") };
}

export async function kompassDetail(ctx: ApiContext, residentInput: unknown): Promise<KompassDetail> {
  const residentId = await assertResident(ctx, residentInput);
  const [residentRows, rows, people, settings, today] = await Promise.all([
    ctx.sql`
      SELECT r.first_name, r.last_name, r.admitted_on, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.id = ${residentId}` as Promise<Row[]>,
    ctx.sql`
      SELECT a.*, u.display_name AS assessor FROM carecore_rai_assessments a
      LEFT JOIN carecore_users u ON u.id = a.responsible_user_id
      WHERE a.resident_id = ${residentId} AND (a.status <> 'archived' OR a.completed_at IS NOT NULL)
      ORDER BY a.completed_at DESC NULLS FIRST, a.updated_at DESC` as Promise<Row[]>,
    raiPeople(ctx),
    kompassSettings(ctx),
    orgToday(ctx),
  ]);
  const resident = residentRows[0];
  const all = rows.map(mapAssessment);
  const history = all.filter((item) => item.completedAt);
  const previous = history.find((item) => item.kompass) ?? null;
  const draft = all.find((item) => item.status === "in_progress") ?? null;
  const planned = all.find((item) => item.status === "new" || item.status === "overdue") ?? null;
  return {
    resident: {
      id: residentId,
      name: `${resident.first_name} ${resident.last_name}`,
      room: String(resident.room),
      unit: String(resident.unit),
      admittedOn: day(resident.admitted_on),
    },
    draft,
    planned: planned ? { id: planned.id, dueOn: planned.dueOn } : null,
    history: history.slice(0, 20),
    previous,
    people,
    context: await kompassContext(ctx, residentId, previous?.completedAt ?? null),
    settings,
    today,
    aiDraft: mistralConfigured() && hasPermission(ctx.actor, "ai.use"),
  };
}

async function assertAssessor(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const assessorId = assertUuid(value, "Verantwortliche Person");
  if (!(await raiPeople(ctx)).some((person) => person.id === assessorId))
    throw new ApiError("Die gewählte Person darf keine Abklärungen mit dem Kompass durchführen.");
  return assessorId;
}

// Neue Abklärung beginnen (eine geplante wird übernommen). Je Person gibt es höchstens einen Entwurf.
export async function startKompass(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentInput);
  const occasion = String(body.occasion ?? "") as Occasion;
  if (!(occasion in OCCASIONS)) throw new ApiError("Bitte den Anlass der Abklärung wählen.");
  const assessedOn = String(body.assessedOn ?? "");
  if (!DATE.test(assessedOn)) throw new ApiError("Bitte das Datum der Abklärung angeben.");
  if (assessedOn > (await orgToday(ctx))) throw new ApiError("Das Datum der Abklärung liegt in der Zukunft.");
  const assessorId = (await assertAssessor(ctx, body.assessorId)) ?? ctx.actor.id;
  const open = (await ctx.sql`
    SELECT id, status, data FROM carecore_rai_assessments WHERE resident_id = ${residentId} AND status = ANY(${OPEN})
    ORDER BY (status = 'in_progress') DESC, due_on NULLS LAST LIMIT 1`) as Row[];
  if (open[0]?.status === "in_progress" && readKompass(open[0].data))
    throw new ApiError("Für diese Person läuft bereits eine Abklärung. Bitte diese fortsetzen.", 409);
  // Ein früherer, nicht abgeschlossener Entwurf ohne Kompass (vereinfachte Erfassung) wird abgelöst.
  const replacesLegacy = open[0]?.status === "in_progress";
  const id = open[0] ? String(open[0].id) : randomUUID();
  const data = JSON.stringify(emptyKompass(occasion, assessedOn));
  await ctx.sql.transaction([
    open[0]
      ? ctx.sql`
          UPDATE carecore_rai_assessments SET assessment_type = ${KOMPASS_INSTRUMENT}, status = 'in_progress',
            responsible_user_id = ${assessorId}, started_at = NOW(), progress = 0, data = ${data}::jsonb, updated_at = NOW()
          WHERE id = ${id} AND status IN ('new', 'overdue', 'in_progress')`
      : ctx.sql`
          INSERT INTO carecore_rai_assessments (id, resident_id, responsible_user_id, assessment_type, status, started_at,
            progress, data)
          VALUES (${id}, ${residentId}, ${assessorId}, ${KOMPASS_INSTRUMENT}, 'in_progress', NOW(), 0, ${data}::jsonb)`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "rai_assessment",
      entityId: id,
      action: "started",
      after: { instrument: KOMPASS_INSTRUMENT, occasion, assessedOn, assessorId, replacesLegacy },
    }),
  ]);
  return { id };
}

async function loadDraft(ctx: ApiContext, residentId: string, idInput: unknown) {
  const id = assertUuid(idInput, "Abklärung");
  const [row] = (await ctx.sql`
    SELECT *, updated_at::text AS stamp FROM carecore_rai_assessments WHERE id = ${id} AND resident_id = ${residentId}`) as Row[];
  if (!row) throw new ApiError("Abklärung nicht gefunden.", 404);
  if (row.status !== "in_progress")
    throw new ApiError("Diese Abklärung ist bereits abgeschlossen oder verworfen.", 409);
  const data = readKompass(row.data);
  if (!data) throw new ApiError("Diese Erfassung kann nicht mit dem Kompass bearbeitet werden.", 409);
  return { id, row, data };
}

// Änderungen des Entwurfs übernehmen (automatisches Speichern). Nur die geschickten Felder werden geändert, damit
// zwei Fenster einander nichts überschreiben; bei gleichzeitigem Speichern wird mit dem neuesten Stand wiederholt.
export async function saveKompassDraft(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentInput);
  const patch = (body.patch && typeof body.patch === "object" ? body.patch : {}) as Record<string, unknown>;
  const today = await orgToday(ctx);
  const assessorId = "assessorId" in patch ? await assertAssessor(ctx, patch.assessorId) : undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { id, row, data } = await loadDraft(ctx, residentId, body.id);
    const next: KompassData = { ...data, answers: { ...data.answers }, domains: { ...data.domains } };
    if (patch.answers && typeof patch.answers === "object")
      for (const [key, value] of Object.entries(patch.answers as Record<string, unknown>)) {
        const item = ITEM_BY_KEY.get(key);
        if (!item) throw new ApiError("Unbekannte Frage.");
        if (value === null) delete next.answers[key];
        else if (validAnswer(item, value)) next.answers[key] = value as string;
        else throw new ApiError(`„${item.label}“: Antwort ist ungültig.`);
      }
    if (patch.domains && typeof patch.domains === "object")
      for (const [domainId, notes] of Object.entries(patch.domains as Record<string, unknown>)) {
        if (!KOMPASS_DOMAINS.some((domain) => domain.id === domainId)) throw new ApiError("Unbekannter Bereich.");
        if (!notes || typeof notes !== "object") continue;
        next.domains[domainId] = { ...next.domains[domainId], ...cleanNotes(notes as Record<string, unknown>) };
        if ((notes as Record<string, unknown>).need === null) delete next.domains[domainId].need;
      }
    if ("occasion" in patch) {
      if (typeof patch.occasion !== "string" || !(patch.occasion in OCCASIONS))
        throw new ApiError("Anlass ist ungültig.");
      next.occasion = patch.occasion as Occasion;
    }
    if ("assessedOn" in patch) {
      if (typeof patch.assessedOn !== "string" || !DATE.test(patch.assessedOn))
        throw new ApiError("Datum der Abklärung ist ungültig.");
      if (patch.assessedOn > today) throw new ApiError("Das Datum der Abklärung liegt in der Zukunft.");
      next.assessedOn = patch.assessedOn;
    }
    if (Array.isArray(patch.participants))
      next.participants = PARTICIPANTS.filter((participant) => (patch.participants as unknown[]).includes(participant));
    if (typeof patch.summary === "string") next.summary = text(patch.summary, 8000);
    const progress = kompassProgress(next);
    const updated = (await ctx.sql`
      UPDATE carecore_rai_assessments SET data = ${JSON.stringify(next)}::jsonb, progress = ${progress},
        responsible_user_id = ${assessorId === undefined ? row.responsible_user_id : assessorId}, updated_at = NOW()
      WHERE id = ${id} AND status = 'in_progress' AND updated_at::text = ${row.stamp}
      RETURNING updated_at`) as Row[];
    if (updated.length) return { id, progress, updatedAt: iso(updated[0].updated_at) };
  }
  throw new ApiError("Die Abklärung wird gerade an anderer Stelle gespeichert. Bitte neu laden.", 409);
}

// Was noch fehlt, damit sich die Abklärung abschliessen lässt (für die Anzeige und die Prüfung beim Abschluss).
export function kompassMissing(data: KompassData) {
  return KOMPASS_DOMAINS.flatMap((domain) => {
    const state = domainProgress(domain, data);
    const missing: string[] = [];
    if (state.answered < state.total)
      missing.push(
        `${domain.title}: ${state.total - state.answered} Frage${state.total - state.answered === 1 ? "" : "n"} offen`,
      );
    if (!state.decided) missing.push(`${domain.title}: Handlungsbedarf festhalten`);
    return missing;
  });
}

// Abschliessen: alle Fragen beantwortet und je Bereich über den Handlungsbedarf entschieden. Die nächste Abklärung
// wird nach dem Abstand der Einrichtung fällig (ohne Einstellung keine automatische Fälligkeit).
export async function completeKompass(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentInput);
  const { id, row, data } = await loadDraft(ctx, residentId, body.id);
  const missing = kompassMissing(data);
  if (missing.length) throw new ApiError(`Zum Abschliessen fehlt noch: ${missing.slice(0, 3).join("; ")}.`);
  if (!data.assessedOn) throw new ApiError("Bitte das Datum der Abklärung angeben.");
  const { intervalMonths } = await kompassSettings(ctx);
  const dueOn = intervalMonths ? addMonths(data.assessedOn, intervalMonths) : null;
  const completed = { ...data, completedBy: ctx.actor.display_name };
  const needs = KOMPASS_DOMAINS.filter((domain) => data.domains[domain.id]?.need).map((domain) => domain.title);
  await ctx.sql
    .transaction([
      // Nur die neueste abgeschlossene Abklärung gilt; frühere bleiben im Verlauf.
      ctx.sql`
        UPDATE carecore_rai_assessments SET status = 'archived', updated_at = NOW()
        WHERE resident_id = ${residentId} AND id <> ${id} AND status IN ('current', 'new', 'overdue')`,
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_rai_assessments SET status = 'current', progress = 100, due_on = ${dueOn},
            completed_at = NOW(), data = ${JSON.stringify(completed)}::jsonb, updated_at = NOW()
          WHERE id = ${id} AND status = 'in_progress' AND updated_at::text = ${row.stamp} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'KOMPASS_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "rai_assessment",
        entityId: id,
        action: "completed",
        after: { instrument: KOMPASS_INSTRUMENT, occasion: data.occasion, assessedOn: data.assessedOn, needs, dueOn },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("KOMPASS_CHANGED"))
        throw new ApiError("Die Abklärung wurde inzwischen geändert. Bitte prüfen und erneut abschliessen.", 409);
      throw error;
    });
  return { id, dueOn };
}

// Entwurf verwerfen (mit Grund); er bleibt im Änderungsprotokoll, erscheint aber nicht mehr im Verlauf.
export async function discardKompass(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentInput);
  const { id } = await loadDraft(ctx, residentId, body.id);
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_rai_assessments SET status = 'archived', updated_at = NOW()
      WHERE id = ${id} AND status = 'in_progress'`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "rai_assessment",
      entityId: id,
      action: "discarded",
      after: { reason },
    }),
  ]);
}

// ---------------------------------------------------------------- Bericht und Übernahme

// Abgeschlossene Abklärung mit der vorherigen (zum Vergleich) und den daraus übernommenen Zielen.
export async function kompassReport(ctx: ApiContext, assessmentInput: unknown): Promise<KompassReport> {
  const assessmentId = assertUuid(assessmentInput, "Abklärung");
  const [row] = (await ctx.sql`
    SELECT a.*, u.display_name AS assessor FROM carecore_rai_assessments a
    JOIN carecore_residents r ON r.id = a.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_users u ON u.id = a.responsible_user_id
    WHERE a.id = ${assessmentId} AND a.completed_at IS NOT NULL`) as Row[];
  if (!row) throw new ApiError("Abklärung nicht gefunden.", 404);
  const assessment = mapAssessment(row);
  if (!assessment.kompass) throw new ApiError("Diese Erfassung wurde nicht mit dem Kompass durchgeführt.", 409);
  const residentId = String(row.resident_id);
  const [residentRows, previousRows] = await Promise.all([
    ctx.sql`
      SELECT r.first_name, r.last_name, to_char(r.date_of_birth, 'YYYY-MM-DD') AS birth_day,
        COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.id = ${residentId}` as Promise<Row[]>,
    ctx.sql`
      SELECT a.*, u.display_name AS assessor FROM carecore_rai_assessments a
      LEFT JOIN carecore_users u ON u.id = a.responsible_user_id
      WHERE a.resident_id = ${residentId} AND a.completed_at IS NOT NULL AND a.completed_at < ${row.completed_at}
        AND a.assessment_type = ${KOMPASS_INSTRUMENT}
      ORDER BY a.completed_at DESC LIMIT 1` as Promise<Row[]>,
  ]);
  const goalIds = Object.values(assessment.kompass.domains)
    .map((notes) => notes.goalId)
    .filter((id): id is string => Boolean(id));
  const goals = goalIds.length
    ? ((await ctx.sql`
        SELECT id, statement, status, to_char(target_date, 'YYYY-MM-DD') AS target_day FROM carecore_care_goals
        WHERE id = ANY(${goalIds}::uuid[])`) as Row[])
    : [];
  const resident = residentRows[0];
  return {
    resident: {
      id: residentId,
      name: `${resident.first_name} ${resident.last_name}`,
      birthDate: (resident.birth_day as string | null) ?? null,
      room: String(resident.room),
      unit: String(resident.unit),
    },
    assessment,
    previous: previousRows[0] ? mapAssessment(previousRows[0]) : null,
    goals: Object.fromEntries(
      goals.map((goal) => [
        String(goal.id),
        {
          statement: String(goal.statement),
          status: String(goal.status),
          targetDate: (goal.target_day as string) ?? null,
        },
      ]),
    ),
    // Übernehmen nur aus der aktuell gültigen Abklärung und mit dem Recht zur Pflegeplanung.
    canAdopt: row.status === "current" && hasPermission(ctx.actor, "documentation.write"),
  };
}

// Handlungsbedarf eines Bereichs als Ziel in die Pflegeplanung übernehmen. Pflegebereich, Problem und Ressourcen
// stammen aus der Abklärung; das Ziel und das Überprüfungsdatum formuliert die Fachperson. Ohne offenen Pflegeplan
// wird einer angelegt.
export async function adoptKompassNeed(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "documentation.write"))
    throw new ApiError("Keine Berechtigung für die Pflegeplanung.", 403);
  const residentId = await assertResident(ctx, residentInput);
  const assessmentId = assertUuid(body.assessmentId, "Abklärung");
  const [row] = (await ctx.sql`
    SELECT *, updated_at::text AS stamp FROM carecore_rai_assessments
    WHERE id = ${assessmentId} AND resident_id = ${residentId}`) as Row[];
  if (!row) throw new ApiError("Abklärung nicht gefunden.", 404);
  if (row.status !== "current")
    throw new ApiError("Übernehmen lässt sich nur aus der aktuell gültigen Abklärung.", 409);
  const data = readKompass(row.data);
  const domain = KOMPASS_DOMAINS.find((item) => item.id === body.domainId);
  if (!data || !domain) throw new ApiError("Bereich nicht gefunden.", 404);
  const notes = data.domains[domain.id] ?? {};
  if (!notes.need || !notes.needText)
    throw new ApiError("In diesem Bereich ist kein Handlungsbedarf festgehalten.", 409);
  if (notes.goalId) {
    const [goal] = (await ctx.sql`SELECT 1 FROM carecore_care_goals WHERE id = ${notes.goalId}`) as Row[];
    if (goal) throw new ApiError("Dieser Handlungsbedarf ist bereits in die Pflegeplanung übernommen.", 409);
  }
  const goalBody = {
    category: domain.planCategory,
    problem: notes.needText,
    resources: notes.resources ?? "",
    statement: body.statement,
    targetDate: body.targetDate,
  };
  // Zuerst prüfen, damit kein leerer Pflegeplan entsteht.
  const goal = parseGoal(goalBody);
  const day = await planToday(ctx);
  if (goal.targetDate && goal.targetDate < day) throw new ApiError("Das Überprüfungsdatum liegt in der Vergangenheit.");
  const [plan] = (await ctx.sql`
    SELECT id FROM carecore_care_plans WHERE resident_id = ${residentId} AND status = ANY(${OPEN_PLANS})
    ORDER BY created_at DESC LIMIT 1`) as Row[];
  const planId = plan
    ? String(plan.id)
    : await createPlan(ctx, {
        residentId,
        focus: `Aus der Abklärung mit dem ${KOMPASS_NAME} vom ${formatDay(data.assessedOn)}`,
        startsOn: day,
        reviewOn: goal.targetDate,
        ownerId: ctx.actor.id,
      });
  const goalId = await addGoal(ctx, planId, goalBody);
  const next = { ...data, domains: { ...data.domains, [domain.id]: { ...notes, goalId } } };
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_rai_assessments SET data = data || ${JSON.stringify({ domains: next.domains })}::jsonb
      WHERE id = ${assessmentId}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "rai_assessment",
      entityId: assessmentId,
      action: "need_adopted",
      after: { domain: domain.title, goalId, planId, createdPlan: !plan },
    }),
  ]);
  return { goalId, planId, createdPlan: !plan };
}

// ---------------------------------------------------------------- Tagesliste und Akte

// Fällige, überfällige und begonnene Abklärungen (für die Tagesliste derjenigen, die den Kompass nutzen dürfen).
export async function dueKompass(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "rai.manage")) return [];
  const { residents } = await raiWorkplace(ctx);
  return residents.filter((row) => row.state === "overdue" || row.state === "due" || row.state === "in_progress");
}

// Kurzstand für den Pflegeprozess in der Akte.
export async function kompassStatus(ctx: ApiContext, residentId: string): Promise<KompassStatusSummary> {
  const rows = (await ctx.sql`
    SELECT status, due_on, completed_at, progress, data, assessment_type FROM carecore_rai_assessments
    WHERE resident_id = ${residentId} AND status IN ('new', 'in_progress', 'overdue', 'current')
    ORDER BY completed_at DESC NULLS LAST`) as Row[];
  const current = rows.find((row) => row.status === "current" && row.assessment_type === KOMPASS_INSTRUMENT);
  const data = current ? readKompass(current.data) : null;
  const open = rows.find((row) => row.status !== "current");
  return {
    lastOn: data?.assessedOn ?? null,
    needs: data ? KOMPASS_DOMAINS.filter((domain) => data.domains[domain.id]?.need).map((domain) => domain.title) : [],
    dueOn: day(open?.due_on) ?? day(current?.due_on),
    inProgress: open?.status === "in_progress" ? Number(open.progress ?? 0) : null,
    canOpen: hasPermission(ctx.actor, "rai.manage"),
  };
}

// ---------------------------------------------------------------- Grundlage für den KI-Entwurf

// Laufende Abklärung einer Person als Text für den Entwurf des Gesamtbilds: Antworten, Notizen und Entscheide der
// Fachperson, dazu Veränderungen gegenüber der letzten abgeschlossenen Abklärung. Ohne Namen.
export async function kompassDraftText(ctx: ApiContext, residentId: string) {
  const rows = (await ctx.sql`
    SELECT id, status, data, completed_at FROM carecore_rai_assessments
    WHERE resident_id = ${residentId} AND assessment_type = ${KOMPASS_INSTRUMENT}
      AND (status = 'in_progress' OR (status IN ('current', 'archived') AND completed_at IS NOT NULL))
    ORDER BY (status = 'in_progress') DESC, completed_at DESC NULLS LAST LIMIT 2`) as Row[];
  const draft = rows[0]?.status === "in_progress" ? rows[0] : null;
  const data = draft ? readKompass(draft.data) : null;
  if (!draft || !data) throw new ApiError("Für diese Person ist keine Abklärung in Bearbeitung.", 404);
  const before = rows[1] ? readKompass(rows[1].data) : null;
  const lines = [
    `Anlass: ${OCCASIONS[data.occasion]}`,
    data.assessedOn ? `Abklärung vom ${formatDay(data.assessedOn)}` : "",
    data.participants.length ? `Beteiligt: ${data.participants.join(", ")}` : "",
    before ? `Letzte abgeschlossene Abklärung: ${formatDay(before.assessedOn)}` : "Erste Abklärung mit dem Kompass",
  ];
  for (const domain of KOMPASS_DOMAINS) {
    const notes = data.domains[domain.id] ?? {};
    lines.push("", `Bereich ${domain.title}:`);
    for (const item of domain.items) {
      const key = `${domain.id}.${item.id}`;
      const answer = optionLabel(item, data.answers[key]);
      const earlier = before ? optionLabel(item, before.answers[key]) : null;
      lines.push(
        `- ${item.label}: ${answer ?? "nicht beantwortet"}${earlier && answer && earlier !== answer ? ` (zuvor: ${earlier})` : ""}`,
      );
    }
    if (notes.resources) lines.push(`Ressourcen: ${notes.resources}`);
    if (notes.wishes) lines.push(`Wünsche und Gewohnheiten: ${notes.wishes}`);
    if (notes.need !== undefined)
      lines.push(
        `Handlungsbedarf (Entscheid der Fachperson): ${notes.need ? `Ja${notes.needText ? ` – ${notes.needText}` : ""}` : "Nein"}`,
      );
    if (notes.notes) lines.push(`Notizen: ${notes.notes}`);
  }
  return { assessmentId: String(draft.id), text: lines.filter((line, index) => line || index > 3).join("\n") };
}

// ---------------------------------------------------------------- Auswertung je Wohnbereich

// Unterstützung oder Beobachtung: jede Antwort über der ersten Stufe der Skala; bei Massnahmen erst „Mit
// Unterstützung“ und „Durch die Pflege“ (macht die Person es selbst, braucht sie dabei keine Hilfe).
const noted = (item: KompassItem, value: string | undefined) =>
  (answerRank(item, value) ?? -1) >= (item.scale === "care" ? 2 : 1);

// Zählt die Antworten der letzten abgeschlossenen Abklärung je Person (optional nur ein Wohnbereich). CareOS
// zählt nur; es gibt keine Punktzahl und keine Einstufung.
export async function kompassStatistics(ctx: ApiContext, careUnitInput: unknown): Promise<KompassStatistics> {
  let careUnit: KompassStatistics["careUnit"] = null;
  if (careUnitInput) {
    const id = assertUuid(careUnitInput, "Wohnbereich");
    const units = (await ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE cu.id = ${id} AND si.organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!units[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
    careUnit = { id, name: String(units[0].name) };
  }
  const careUnitId = careUnit?.id ?? null;
  const rows = (await ctx.sql`
    SELECT r.id, done.data
    FROM carecore_residents r
    LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN LATERAL (SELECT data FROM carecore_rai_assessments WHERE resident_id = r.id AND status = 'current'
      AND assessment_type = ${KOMPASS_INSTRUMENT} ORDER BY completed_at DESC NULLS LAST LIMIT 1) done ON TRUE
    WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)`) as Row[];
  const assessments = rows.map((row) => readKompass(row.data)).filter((data): data is KompassData => data !== null);
  return {
    careUnit,
    people: rows.length,
    assessed: assessments.length,
    domains: KOMPASS_DOMAINS.map((domain) => {
      const keyOf = (itemId: string) => `${domain.id}.${itemId}`;
      return {
        id: domain.id,
        title: domain.title,
        withSupport: assessments.filter((data) =>
          domain.items.some((item) => noted(item, data.answers[keyOf(item.id)])),
        ).length,
        withNeed: assessments.filter((data) => data.domains[domain.id]?.need === true).length,
        items: domain.items.map((item) => {
          const values = assessments.map((data) => data.answers[keyOf(item.id)]).filter((value) => value !== undefined);
          return {
            key: keyOf(item.id),
            label: item.label,
            counts: SCALES[item.scale].options.map((option) => ({
              value: option.value,
              label: option.label,
              count: values.filter((value) => value === option.value).length,
            })),
            notApplicable: values.filter((value) => value === NOT_APPLICABLE).length,
            answered: values.length,
          };
        }),
      };
    }),
  };
}
