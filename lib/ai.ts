import { randomUUID } from "node:crypto";
import { readTerms } from "@/lib/settings";
import type { Terms } from "@/lib/terminology";
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
import { AI_TASKS, type AiDraft, type AiOverview, type AiTask } from "@/lib/ai-shared";
import { createEntry } from "@/lib/documentation";
import { createNote } from "@/lib/handover";
import { auditOrigin } from "@/lib/audit-origin";
import { MistralError, mistralConfigured, mistralModel, mistralText } from "@/lib/mistral";
import { kompassDraftText } from "@/lib/kompass";
import { pseudonymize } from "@/lib/pseudonymize";

// CareOS KI: drafts from Mistral based on the care data of one resident or one care
// unit. Drafts are never saved to the record automatically; staff review, edit and
// accept or discard them. Residents are sent pseudonymised (initials, age, room).

export const aiConfigured = mistralConfigured;

// Standard: Mistral. Tests setzen ein Test-Double.
type DraftCall = typeof mistralText;
let draftCall: DraftCall = mistralText;
export const setDraftCall = (call: DraftCall) => {
  draftCall = call;
};

const SYSTEM = `Du bist die Assistenz von CareOS, einer Pflegedokumentation für Alters- und Pflegeheime in der Schweiz.
Du unterstützt Pflegefachpersonen mit Entwürfen. Schreibe auf Deutsch (Schweizer Rechtschreibung, kein ß), sachlich, knapp und fachlich korrekt.
Stütze dich ausschliesslich auf die mitgelieferten Daten. Erfinde keine Werte, Diagnosen oder Ereignisse; fehlt etwas, sage das.
Bewohnende sind pseudonymisiert (Kürzel). Verwende nur diese Kürzel.
Du stellst keine Diagnosen und ordnest keine Medikation an; wo ärztliche Abklärung angezeigt ist, empfiehl sie.
Antworte als reiner Text ohne Markdown-Überschriften; einfache Aufzählungen mit "- " sind erlaubt.`;

const INSTRUCTIONS: Record<AiTask, string> = {
  handover:
    "Fasse die Daten als strukturierte Schichtübergabe zusammen: zuerst Dringendes, dann pro Bewohner:in die wichtigsten Punkte und offene Aufgaben für den nächsten Dienst.",
  risks:
    "Prüfe die Daten auf Risiken, die bei der nächsten Arztvisite oder Pflegevisite angesprochen werden sollten (z. B. auffällige Vitalwerte, Sturz, Schmerz, Wunden, Medikation, fehlende Dokumentation). Nenne pro Risiko die Datengrundlage und einen Vorschlag für das weitere Vorgehen.",
  documentation:
    "Formuliere einen Entwurf für einen Pflegebericht zum aktuellen Dienst auf Basis der Daten und der Stichworte der Pflegefachperson. Schreibe in der dritten Person, im Präsens oder Perfekt, ohne Wertungen. Nur der Berichtstext, ohne Einleitung.",
  carePlan:
    "Schlage Ergänzungen für die Pflegeplanung dieser einen Bewohner:in vor. Gliedere nach Pflegeproblemen; nenne je Problem die Ressourcen, ein überprüfbares Ziel und konkrete Massnahmen (mit Häufigkeit, wo die Daten sie nahelegen) sowie die Datengrundlage (z. B. Einschätzung, Bericht, Vitalwert). Bestehende Ziele und Massnahmen nicht erneut vorschlagen; weise stattdessen auf solche hin, die nach den Daten überprüft werden sollten. Keine Grenzwerte, Fristen oder Skalenwerte erfinden, die nicht in den Daten stehen. Keine Diagnosen, keine Medikation; wo ärztliche Abklärung angezeigt ist, empfiehl sie.",
  question: "Beantworte die Frage der Pflegefachperson auf Basis der Daten.",
  rephrase:
    "Formuliere den diktierten Rohtext der Pflegefachperson als sachlichen Eintrag für den Pflegebericht um: vollständige Sätze, Fachsprache der Pflege, dritte Person, Präsens oder Perfekt, ohne Wertungen. Korrigiere offensichtliche Fehler der Spracherkennung, Grammatik und Zeichensetzung. Übernimm alle Fakten, Zeiten, Mengen und Beobachtungen vollständig und unverändert; füge nichts hinzu und lass nichts weg. Platzhalter in eckigen Klammern wie [Person 1] übernimmst du genau so. Nur der Berichtstext, ohne Einleitung.",
  kompassSummary:
    "Formuliere einen Entwurf für das Gesamtbild einer Bedarfsabklärung mit dem CareOS Kompass, aus Sicht der Pflegefachperson. Fliesstext mit 4 bis 8 Sätzen, beschreibend und wertschätzend: was den Alltag der Person zurzeit prägt, was ihr wichtig ist (aus Ressourcen, Wünschen und Gewohnheiten), was sich seit der letzten Abklärung verändert hat und in welchen Bereichen die Fachperson Handlungsbedarf festgehalten hat. Übernimm die Entscheide der Fachperson unverändert; bewerte den Bedarf nicht selbst, nenne keine Risiken, Punktzahlen, Stufen oder Diagnosen und füge nichts hinzu, was nicht in den Daten steht.",
};

function age(dateOfBirth: unknown) {
  const value = iso(dateOfBirth);
  if (!value) return null;
  const born = new Date(value);
  const now = new Date();
  return (
    now.getFullYear() -
    born.getFullYear() -
    (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0)
  );
}

const kuerzel = (row: Row) => `${String(row.first_name)[0] ?? ""}${String(row.last_name)[0] ?? ""}`.toUpperCase();
const when = (value: unknown) =>
  new Date(iso(value) ?? "").toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// Care data of the last days for the given residents, as compact text for the prompt. For care planning
// (`planning`) additionally the latest assessments, the problems, resources and measures of the active goals and
// two weeks of reports.
export async function residentContext(ctx: ApiContext, residentIds: string[], t: Terms, planning = false) {
  if (!residentIds.length) return "";
  const reportHours = planning ? 14 * 24 : 48;
  const [residents, docs, vitals, meds, wounds, tasks, goals, measures, assessments] = (await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, r.date_of_birth, r.risk_flags, COALESCE(ro.name, '') AS room
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.id = ANY(${residentIds}) ORDER BY ro.name NULLS LAST, r.last_name`,
    ctx.sql`
      SELECT resident_id, category, body, occurred_at, importance FROM carecore_documentation_entries
      WHERE resident_id = ANY(${residentIds}) AND occurred_at > NOW() - make_interval(hours => ${reportHours})
      ORDER BY occurred_at DESC LIMIT ${planning ? 120 : 60}`,
    ctx.sql`
      SELECT resident_id, metric, value, secondary_value, unit, status, measured_at FROM carecore_vital_measurements
      WHERE resident_id = ANY(${residentIds}) AND measured_at > NOW() - INTERVAL '7 days'
      ORDER BY measured_at DESC LIMIT 80`,
    ctx.sql`
      SELECT o.resident_id, m.name, o.is_prn, o.indication FROM carecore_medication_orders o
      JOIN carecore_medications m ON m.id = o.medication_id
      WHERE o.resident_id = ANY(${residentIds}) AND o.status = 'active'`,
    ctx.sql`
      SELECT resident_id, title, body_location, severity, status FROM carecore_wounds
      WHERE resident_id = ANY(${residentIds}) AND status IN ('active', 'healing')`,
    ctx.sql`
      SELECT resident_id, title, priority, due_at FROM carecore_tasks
      WHERE resident_id = ANY(${residentIds}) AND status IN ('open', 'in_progress', 'escalated') ORDER BY due_at NULLS LAST LIMIT 40`,
    ctx.sql`
      SELECT p.resident_id, g.category, g.statement, g.target_date, g.problem, g.resources FROM carecore_care_goals g
      JOIN carecore_care_plans p ON p.id = g.care_plan_id
      WHERE p.resident_id = ANY(${residentIds}) AND p.status IN ('active', 'review') AND g.status = 'active'`,
    planning
      ? ctx.sql`
      SELECT p.resident_id, g.category, i.title, i.frequency FROM carecore_interventions i
      JOIN carecore_care_goals g ON g.id = i.care_goal_id JOIN carecore_care_plans p ON p.id = g.care_plan_id
      WHERE p.resident_id = ANY(${residentIds}) AND p.status IN ('active', 'review') AND g.status = 'active'
        AND i.status = 'active'`
      : Promise.resolve([]),
    planning
      ? ctx.sql`
      SELECT DISTINCT ON (ar.resident_id, ar.assessment_id) ar.resident_id, a.name, ar.score, ar.risk_level, ar.summary,
        ar.completed_at
      FROM carecore_assessment_records ar JOIN carecore_assessments a ON a.id = ar.assessment_id
      WHERE ar.resident_id = ANY(${residentIds}) AND ar.status = 'completed'
      ORDER BY ar.resident_id, ar.assessment_id, ar.completed_at DESC`
      : Promise.resolve([]),
  ])) as Row[][];
  const of = (rows: Row[], id: unknown) => rows.filter((row) => row.resident_id === id);
  return residents
    .map((resident) => {
      const flags = Array.isArray(resident.risk_flags)
        ? (resident.risk_flags as Array<{ label?: string }>).map((flag) => flag.label).filter(Boolean)
        : [];
      const lines = [
        `${t.one}:in ${kuerzel(resident)} (${age(resident.date_of_birth) ?? "?"} J., ${resident.room || "ohne Zimmer"})`,
        flags.length ? `Hinweise: ${flags.join(", ")}` : "",
        ...of(goals, resident.id).map(
          (row) =>
            `Pflegeziel (${row.category}): ${row.statement}${planning && row.problem ? ` – Problem: ${row.problem}` : ""}${
              planning && row.resources ? ` – Ressourcen: ${row.resources}` : ""
            }`,
        ),
        ...of(measures, resident.id).map(
          (row) => `Massnahme (${row.category}): ${row.title}${row.frequency ? `, ${row.frequency}` : ""}`,
        ),
        ...of(assessments, resident.id).map(
          (row) =>
            `Einschätzung ${when(row.completed_at)}: ${row.name}${row.score !== null ? `, Punkte ${Number(row.score)}` : ""}${
              row.risk_level ? `, ${row.risk_level}` : ""
            }${row.summary ? ` – ${String(row.summary).slice(0, 400)}` : ""}`,
        ),
        ...of(meds, resident.id).map(
          (row) =>
            `Medikation: ${row.name}${row.is_prn ? " (Reserve)" : ""}${row.indication ? ` – ${row.indication}` : ""}`,
        ),
        ...of(wounds, resident.id).map(
          (row) => `Wunde: ${row.title}, ${row.body_location} (${row.status}, ${row.severity})`,
        ),
        ...of(vitals, resident.id).map(
          (row) =>
            `Vitalwert ${when(row.measured_at)}: ${row.metric} ${Number(row.value)}${
              row.secondary_value !== null ? `/${Number(row.secondary_value)}` : ""
            } ${row.unit}${row.status !== "normal" ? ` (${row.status})` : ""}`,
        ),
        ...of(docs, resident.id).map(
          (row) =>
            `Bericht ${when(row.occurred_at)} [${row.category}${row.importance !== "standard" ? `, ${row.importance}` : ""}]: ${String(row.body).slice(0, 600)}`,
        ),
        ...of(tasks, resident.id).map(
          (row) => `Offene Aufgabe: ${row.title}${row.due_at ? ` (fällig ${when(row.due_at)})` : ""}`,
        ),
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

async function unitResidentIds(ctx: ApiContext, careUnitId: string | null) {
  const rows = (await ctx.sql`
    SELECT r.id FROM carecore_residents r
    JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
    LIMIT 40`) as Row[];
  return rows.map((row) => String(row.id));
}

async function assertUnit(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Wohnbereich");
  const rows = await ctx.sql`
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE cu.id = ${id} AND si.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  return id;
}

export async function aiOverview(ctx: ApiContext, careUnitIdInput: string | null): Promise<AiOverview> {
  const careUnitId = await assertUnit(ctx, careUnitIdInput);
  const rows = (await ctx.sql`
    WITH res AS (
      SELECT r.id FROM carecore_residents r
      JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid))
    SELECT
      (SELECT name FROM carecore_care_units WHERE id = ${careUnitId}::uuid) AS unit,
      (SELECT COUNT(*) FROM res)::int AS residents,
      (SELECT COUNT(*) FROM carecore_tasks WHERE resident_id IN (SELECT id FROM res) AND status IN ('open', 'in_progress', 'escalated'))::int AS tasks,
      (SELECT COUNT(DISTINCT resident_id) FROM carecore_vital_measurements WHERE resident_id IN (SELECT id FROM res)
        AND status = 'critical' AND measured_at > NOW() - INTERVAL '24 hours')::int AS critical,
      (SELECT COUNT(*) FROM carecore_handovers h WHERE h.organization_id = ${ctx.actor.organizationId}
        AND h.created_at > NOW() - INTERVAL '72 hours' AND (${careUnitId}::uuid IS NULL OR h.care_unit_id = ${careUnitId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM carecore_handover_reads rd WHERE rd.handover_id = h.id AND rd.user_id = ${ctx.actor.id}))::int AS handovers,
      (SELECT COUNT(*) FROM carecore_ai_drafts WHERE organization_id = ${ctx.actor.organizationId} AND status = 'draft')::int AS pending`) as Row[];
  const row = rows[0] ?? {};
  return {
    configured: aiConfigured(),
    context: {
      careUnit: row.unit ? String(row.unit) : null,
      residents: Number(row.residents ?? 0),
      openTasks: Number(row.tasks ?? 0),
      criticalVitals: Number(row.critical ?? 0),
      unreadHandovers: Number(row.handovers ?? 0),
    },
    pending: Number(row.pending ?? 0),
  };
}

function mapDraft(row: Row): AiDraft {
  return {
    id: String(row.id),
    task: (String(row.type) in AI_TASKS ? String(row.type) : "question") as AiTask,
    prompt: String(row.prompt ?? ""),
    content: String(row.content),
    status: row.status as AiDraft["status"],
    residentId: row.resident_id ? String(row.resident_id) : null,
    residentName: row.first_name ? `${row.first_name} ${row.last_name}` : null,
    requestedBy: row.requested_name ? String(row.requested_name) : null,
    reviewedBy: row.reviewed_name ? String(row.reviewed_name) : null,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at) ?? "",
    savedAs:
      row.saved_entity_type === "documentation" || row.saved_entity_type === "handover" ? row.saved_entity_type : null,
  };
}

export async function listDrafts(ctx: ApiContext): Promise<AiDraft[]> {
  const rows = (await ctx.sql`
    SELECT d.*, r.first_name, r.last_name, ru.display_name AS requested_name, vu.display_name AS reviewed_name
    FROM carecore_ai_drafts d
    LEFT JOIN carecore_residents r ON r.id = d.resident_id
    LEFT JOIN carecore_users ru ON ru.id = d.requested_by
    LEFT JOIN carecore_users vu ON vu.id = d.reviewed_by
    WHERE d.organization_id = ${ctx.actor.organizationId}
    ORDER BY d.status = 'draft' DESC, d.created_at DESC LIMIT 60`) as Row[];
  return rows.map(mapDraft);
}

async function draftById(ctx: ApiContext, id: string) {
  const rows = (await ctx.sql`
    SELECT d.*, r.first_name, r.last_name, ru.display_name AS requested_name, vu.display_name AS reviewed_name
    FROM carecore_ai_drafts d
    LEFT JOIN carecore_residents r ON r.id = d.resident_id
    LEFT JOIN carecore_users ru ON ru.id = d.requested_by
    LEFT JOIN carecore_users vu ON vu.id = d.reviewed_by
    WHERE d.id = ${id} AND d.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Entwurf nicht gefunden.", 404);
  return rows[0];
}

async function requestText(user: string, maxOutputTokens: number) {
  let content = "";
  try {
    const response = await draftCall({ system: SYSTEM, user, maxOutputTokens });
    content = response.text;
    if (content && response.truncated) content += "\n\n[Antwort gekürzt]";
  } catch (error) {
    if (error instanceof MistralError)
      throw new ApiError(error.status === 503 ? `CareOS KI: ${error.message}` : error.message, error.status);
    throw error;
  }
  if (!content) throw new ApiError("Die KI hat keinen Text geliefert. Bitte erneut versuchen.", 502);
  return content;
}

export async function generateDraft(ctx: ApiContext, body: Record<string, unknown>): Promise<AiDraft> {
  if (!aiConfigured())
    throw new ApiError("CareOS KI ist noch nicht eingerichtet: MISTRAL_API_KEY fehlt in der Umgebung.", 503);
  const task = (
    typeof body.task === "string" && body.task in AI_TASKS && !["kompassSummary", "rephrase"].includes(body.task)
      ? body.task
      : "question"
  ) as AiTask;
  const prompt = text(body.prompt, 2000);
  if (task === "question" && prompt.length < 3) throw new ApiError("Bitte eine Frage oder einen Auftrag eingeben.");
  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  const t = await readTerms(ctx);
  // Pflegeplanung ist persönlich: nur für eine Person, nicht für den ganzen Wohnbereich.
  if (task === "carePlan" && !residentId)
    throw new ApiError(`Für Vorschläge zur Pflegeplanung bitte eine ${t.one}:in wählen.`);
  const careUnitId = residentId ? null : await assertUnit(ctx, body.careUnitId);
  const residentIds = residentId ? [residentId] : await unitResidentIds(ctx, careUnitId);
  const data = await residentContext(ctx, residentIds, t, task === "carePlan");

  const content = await requestText(
    [
      `Auftrag: ${INSTRUCTIONS[task].replace("Bewohner:in", `${t.one}:in`)}`,
      prompt ? `Hinweise der Pflegefachperson: ${prompt}` : "",
      `Daten (${residentId ? `eine ${t.one}:in` : `${residentIds.length} ${t.one}:innen des Wohnbereichs`}, Stand ${when(new Date())}):`,
      data || "Keine Daten vorhanden.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    16000,
  );

  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_ai_drafts (id, organization_id, resident_id, care_unit_id, requested_by, type, prompt, content, model)
    VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${careUnitId}, ${ctx.actor.id}, ${task}, ${prompt || null},
      ${content}, ${mistralModel()})`,
    auditStatement(ctx, "ai_draft", id, "created", null, { task, residentId, careUnitId }),
  ]);
  return mapDraft(await draftById(ctx, id));
}

// Accepting saves the (possibly edited) text: a documentation draft with a resident as
// a care report, a handover summary as handover note; other drafts are only marked.
export async function reviewDraft(ctx: ApiContext, idInput: string, body: Record<string, unknown>): Promise<AiDraft> {
  const id = assertUuid(idInput, "Entwurf");
  const before = await draftById(ctx, id);
  if (before.status === "accepted" || before.status === "discarded")
    throw new ApiError("Der Entwurf wurde bereits bearbeitet.", 409);
  const action = String(body.action ?? "");
  const content = text(body.content, 10000) || String(before.content);
  if (action !== "discard" && action !== "save" && action !== "accept") throw new ApiError("Aktion ist ungültig.");
  const status = action === "accept" ? "accepted" : action === "discard" ? "discarded" : "reviewed";
  // Status und Protokoll in einer Anweisung; nur ein noch offener Entwurf ändert sich. So entsteht auch bei
  // doppeltem Klick auf „Übernehmen“ nur ein Eintrag.
  const claimed = (await ctx.sql`
    WITH changed AS (
      UPDATE carecore_ai_drafts SET content = ${action === "discard" ? String(before.content) : content}, status = ${status},
        reviewed_by = ${ctx.actor.id}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND status NOT IN ('accepted', 'discarded')
      RETURNING id)
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, before_data, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'ai_draft', changed.id, ${status},
      ${JSON.stringify({ status: before.status })}::jsonb, ${JSON.stringify({ status: action })}::jsonb
    FROM changed RETURNING entity_id`) as Row[];
  if (!claimed[0]) throw new ApiError("Der Entwurf wurde bereits bearbeitet.", 409);
  if (action === "accept") {
    let savedType: string | null = null;
    let savedId: string | null = null;
    if (before.type === "documentation" && before.resident_id) {
      savedId = await createEntry(ctx, {
        residentId: before.resident_id,
        category: typeof body.category === "string" ? body.category : "Pflege",
        body: content,
      });
      savedType = "documentation";
    } else if (before.type === "handover") {
      savedId = await createNote(ctx, {
        content: content.slice(0, 2000),
        residentId: before.resident_id ?? undefined,
        careUnitId: before.care_unit_id ?? undefined,
      });
      savedType = "handover";
    }
    if (savedId)
      await ctx.sql`
        UPDATE carecore_ai_drafts SET saved_entity_type = ${savedType}, saved_entity_id = ${savedId}, updated_at = NOW()
        WHERE id = ${id}`;
  }
  return mapDraft(await draftById(ctx, id));
}

// Entwurf für das Gesamtbild einer laufenden Kompass-Abklärung. Die Person erscheint nur als Kürzel mit Alter; der
// Entwurf wird nicht gespeichert, bis die Fachperson ihn ins Gesamtbild übernimmt und die Abklärung selbst abschliesst.
export async function draftKompassSummary(ctx: ApiContext, residentInput: unknown): Promise<AiDraft> {
  if (!aiConfigured())
    throw new ApiError("CareOS KI ist noch nicht eingerichtet: MISTRAL_API_KEY fehlt in der Umgebung.", 503);
  const residentId = await assertResident(ctx, residentInput);
  const [{ assessmentId, text: data }, rows] = await Promise.all([
    kompassDraftText(ctx, residentId),
    ctx.sql`SELECT first_name, last_name, date_of_birth FROM carecore_residents WHERE id = ${residentId}` as Promise<
      Row[]
    >,
  ]);
  const t = await readTerms(ctx);
  const content = await requestText(
    [
      `Auftrag: ${INSTRUCTIONS.kompassSummary}`,
      `${t.one}:in ${kuerzel(rows[0])} (${age(rows[0].date_of_birth) ?? "?"} J.)`,
      `Abklärung (Stand ${when(new Date())}):`,
      data,
    ].join("\n\n"),
    4000,
  );
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_ai_drafts (id, organization_id, resident_id, requested_by, type, prompt, content, model)
    VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${ctx.actor.id}, 'kompassSummary', NULL, ${content},
      ${mistralModel()})`,
    auditStatement(ctx, "ai_draft", id, "created", null, { task: "kompassSummary", residentId, assessmentId }),
  ]);
  return mapDraft(await draftById(ctx, id));
}

// Diktierten oder getippten Rohtext als Pflegebericht umformulieren (nur Entwurf; die Fachperson übernimmt ihn).
export async function rephraseText(ctx: ApiContext, body: Record<string, unknown>): Promise<AiDraft> {
  if (!aiConfigured())
    throw new ApiError("CareOS KI ist noch nicht eingerichtet: MISTRAL_API_KEY fehlt in der Umgebung.", 503);
  const raw = text(body.text, 4000);
  if (raw.length < 10) throw new ApiError("Bitte zuerst etwas diktieren oder schreiben.");
  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  const people = (await ctx.sql`
    SELECT first_name, last_name FROM carecore_residents WHERE organization_id = ${ctx.actor.organizationId}
    UNION ALL
    SELECT split_part(u.display_name, ' ', 1), NULLIF(substr(u.display_name, length(split_part(u.display_name, ' ', 1)) + 2), '')
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const names = people.flatMap((row) => {
    const first = String(row.first_name ?? "");
    const last = String(row.last_name ?? "");
    return [`${first} ${last}`, `${last} ${first}`, first, last];
  });
  const pseudonym = pseudonymize(raw, names);
  const answer = await requestText(
    [`Auftrag: ${INSTRUCTIONS.rephrase}`, "Rohtext:", pseudonym.text].join("\n\n"),
    4000,
  );
  const content = pseudonym.restore(answer);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_ai_drafts (id, organization_id, resident_id, requested_by, type, prompt, content, model)
    VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${ctx.actor.id}, 'rephrase', ${raw}, ${content},
      ${mistralModel()})`,
    auditStatement(ctx, "ai_draft", id, "created", null, { task: "rephrase", residentId, names: pseudonym.count }),
  ]);
  return mapDraft(await draftById(ctx, id));
}
