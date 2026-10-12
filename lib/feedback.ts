import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import {
  FEEDBACK_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_RESPONSE_DAYS_MAX,
  FEEDBACK_SOURCES,
  type Feedback,
  type FeedbackChannel,
  type FeedbackEvaluation,
  type FeedbackKind,
  type FeedbackOverview,
  type FeedbackSource,
  type FeedbackStatus,
} from "@/lib/feedback-shared";

// Rückmeldungen und Beschwerden: Erfassung (Pflege oder Qualitätsmanagement), Bearbeitung durch die zuständige Person,
// Antwort, Abschluss, Antwortfrist der Einrichtung und Auswertung für das Qualitätsmanagement.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = "/c/leitung/qualitaet/rueckmeldungen";

const canManage = (ctx: ApiContext) => hasPermission(ctx.actor, "quality.manage");
const canRecord = (ctx: ApiContext) => canManage(ctx) || hasPermission(ctx.actor, "residents.write");

const day = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value)) throw new ApiError(`${label} ist ungültig.`);
  return value;
};

async function context(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today, settings->'feedbackResponseDays' AS days
    FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const days = Number(row.days);
  return {
    today: String(row.today),
    responseDays: Number.isInteger(days) && days > 0 ? days : null,
  };
}

// Antwortfrist der Einrichtung in Tagen ({ days }; leer = keine Frist).
export async function saveFeedbackResponseDays(ctx: ApiContext, body: Record<string, unknown>) {
  if (!canManage(ctx)) throw new ApiError("Keine Berechtigung.", 403);
  const days = body.days === null || body.days === undefined || body.days === "" ? null : Number(body.days);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > FEEDBACK_RESPONSE_DAYS_MAX))
    throw new ApiError(`Die Frist ist ungültig (1 bis ${FEEDBACK_RESPONSE_DAYS_MAX} Tage).`);
  const before = (await context(ctx)).responseDays;
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = CASE WHEN ${days}::int IS NULL THEN COALESCE(settings, '{}'::jsonb) - 'feedbackResponseDays'
          ELSE jsonb_set(COALESCE(settings, '{}'::jsonb), '{feedbackResponseDays}', to_jsonb(${days}::int)) END,
        updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, "feedback_response_days", { days: before }, { days }),
  ]);
  return days;
}

const toFeedback = (row: Row, today: string, canEdit: boolean): Feedback => {
  const status = row.status as FeedbackStatus;
  const dueOn = (row.due_day as string | null) ?? null;
  return {
    id: String(row.id),
    kind: row.kind as FeedbackKind,
    source: row.source as FeedbackSource,
    sourceName: String(row.source_name),
    contact: String(row.contact),
    channel: row.channel as FeedbackChannel,
    residentId: (row.resident_id as string | null) ?? null,
    residentName: (row.resident_name as string | null) ?? null,
    careUnitId: (row.care_unit_id as string | null) ?? null,
    careUnitName: (row.care_unit_name as string | null) ?? null,
    topic: String(row.topic),
    description: String(row.description),
    receivedOn: String(row.received_day),
    dueOn,
    overdue: dueOn !== null && dueOn < today && (status === "open" || status === "in_progress"),
    assignedTo: (row.assigned_to as string | null) ?? null,
    assignedName: (row.assigned_name as string | null) ?? null,
    status,
    measures: String(row.measures),
    response: String(row.response),
    answeredOn: (row.answered_day as string | null) ?? null,
    answeredBy: (row.answered_name as string | null) ?? null,
    closed: row.closed_at ? { at: iso(row.closed_at) ?? "", by: (row.closed_name as string | null) ?? null } : null,
    recordedBy: (row.created_name as string | null) ?? null,
    canEdit,
  };
};

function evaluate(items: Feedback[], year: number): FeedbackEvaluation {
  const own = items.filter((item) => Number(item.receivedOn.slice(0, 4)) === year);
  const count = <K extends string>(keys: K[], pick: (item: Feedback) => K) =>
    Object.fromEntries(keys.map((key) => [key, own.filter((item) => pick(item) === key).length])) as Record<K, number>;
  const topics = [...new Set(own.map((item) => item.topic || "Ohne Thema"))].sort((a, b) => a.localeCompare(b));
  const answered = own.filter((item) => item.answeredOn);
  const days = answered
    .map((item) => (Date.parse(item.answeredOn!) - Date.parse(item.receivedOn)) / 86_400_000)
    .sort((a, b) => a - b);
  const median =
    days.length === 0
      ? null
      : days.length % 2
        ? days[(days.length - 1) / 2]
        : (days[days.length / 2 - 1] + days[days.length / 2]) / 2;
  const withDeadline = own.filter((item) => item.dueOn && item.kind !== "praise");
  return {
    year,
    total: own.length,
    byKind: count(Object.keys(FEEDBACK_KINDS) as FeedbackKind[], (item) => item.kind),
    bySource: count(Object.keys(FEEDBACK_SOURCES) as FeedbackSource[], (item) => item.source),
    byTopic: topics.map((topic) => {
      const inTopic = own.filter((item) => (item.topic || "Ohne Thema") === topic);
      return {
        topic,
        complaint: inTopic.filter((item) => item.kind === "complaint").length,
        suggestion: inTopic.filter((item) => item.kind === "suggestion").length,
        praise: inTopic.filter((item) => item.kind === "praise").length,
      };
    }),
    byMonth: Array.from(
      { length: 12 },
      (_, month) => own.filter((item) => Number(item.receivedOn.slice(5, 7)) === month + 1).length,
    ),
    answered: answered.length,
    answeredInTime: withDeadline.filter((item) => item.answeredOn && item.answeredOn <= item.dueOn!).length,
    withDeadline: withDeadline.length,
    medianDays: median === null ? null : Math.round(median * 10) / 10,
  };
}

export async function feedbackOverview(ctx: ApiContext, yearInput: unknown): Promise<FeedbackOverview> {
  if (!canRecord(ctx)) throw new ApiError("Keine Berechtigung.", 403);
  const manage = canManage(ctx);
  const org = ctx.actor.organizationId;
  const { today, responseDays } = await context(ctx);
  const year =
    typeof yearInput === "string" && /^\d{4}$/.test(yearInput) ? Number(yearInput) : Number(today.slice(0, 4));
  const [rows, residents, units, staff] = (await Promise.all([
    ctx.sql`
      SELECT f.*, to_char(f.received_on, 'YYYY-MM-DD') AS received_day, to_char(f.due_on, 'YYYY-MM-DD') AS due_day,
        to_char(f.answered_on, 'YYYY-MM-DD') AS answered_day, r.last_name || ' ' || r.first_name AS resident_name,
        cu.name AS care_unit_name, a.display_name AS assigned_name, b.display_name AS answered_name,
        c.display_name AS closed_name, w.display_name AS created_name
      FROM carecore_feedback f
      LEFT JOIN carecore_residents r ON r.id = f.resident_id
      LEFT JOIN carecore_care_units cu ON cu.id = f.care_unit_id
      LEFT JOIN carecore_users a ON a.id = f.assigned_to
      LEFT JOIN carecore_users b ON b.id = f.answered_by
      LEFT JOIN carecore_users c ON c.id = f.closed_by
      LEFT JOIN carecore_users w ON w.id = f.created_by
      WHERE f.organization_id = ${org}
        AND (${manage} OR f.assigned_to = ${ctx.actor.id} OR f.created_by = ${ctx.actor.id})
      ORDER BY (f.status IN ('answered', 'closed')), f.received_on DESC, f.created_at DESC`,
    ctx.sql`
      SELECT id, last_name || ' ' || first_name AS name FROM carecore_residents
      WHERE organization_id = ${org} AND status IN ('active', 'planned') ORDER BY last_name, first_name`,
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name`,
    ctx.sql`
      SELECT u.id, u.display_name AS name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL ORDER BY u.display_name`,
  ])) as Row[][];
  const items = rows.map((row) => toFeedback(row, today, manage || row.assigned_to === ctx.actor.id));
  return {
    canManage: manage,
    today,
    responseDays,
    items: items.filter(
      (item) => item.status === "open" || item.status === "in_progress" || Number(item.receivedOn.slice(0, 4)) === year,
    ),
    topics: [...new Set(items.map((item) => item.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    residents: residents.map((row) => ({ id: String(row.id), name: String(row.name) })),
    careUnits: units.map((row) => ({ id: String(row.id), name: String(row.name) })),
    staff: staff.map((row) => ({ id: String(row.id), name: String(row.name) })),
    evaluation: evaluate(items, year),
  };
}

async function references(ctx: ApiContext, body: Record<string, unknown>) {
  const org = ctx.actor.organizationId;
  const residentId = body.residentId ? assertUuid(body.residentId, "Person") : null;
  const careUnitId = body.careUnitId ? assertUuid(body.careUnitId, "Wohnbereich") : null;
  const assignedTo = body.assignedTo ? assertUuid(body.assignedTo, "Zuständige Person") : null;
  const [check] = (await ctx.sql`
    SELECT
      (${residentId}::uuid IS NULL OR EXISTS (SELECT 1 FROM carecore_residents WHERE id = ${residentId}::uuid AND organization_id = ${org})) AS resident,
      (${careUnitId}::uuid IS NULL OR EXISTS (SELECT 1 FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
        WHERE cu.id = ${careUnitId}::uuid AND s.organization_id = ${org})) AS unit,
      (${assignedTo}::uuid IS NULL OR EXISTS (SELECT 1 FROM carecore_user_profiles WHERE user_id = ${assignedTo}::uuid
        AND organization_id = ${org})) AS staff`) as Row[];
  if (!check.resident) throw new ApiError("Person nicht gefunden.", 404);
  if (!check.unit) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  if (!check.staff) throw new ApiError("Zuständige Person nicht gefunden.", 404);
  return { residentId, careUnitId, assignedTo };
}

function assignNotice(ctx: ApiContext, assignedTo: string | null, id: string, kind: FeedbackKind, topic: string) {
  return assignedTo && assignedTo !== ctx.actor.id
    ? [
        ctx.sql`
          INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
          VALUES (gen_random_uuid(), ${assignedTo}, ${`${FEEDBACK_KINDS[kind]} zur Bearbeitung`},
            ${topic ? `Thema: ${topic}` : "Bitte bearbeiten und beantworten."}, 'feedback_assigned', 'normal', ${LINK},
            'feedback', ${id})`,
      ]
    : [];
}

// Rückmeldung erfassen ({ kind, source, sourceName?, contact?, channel, residentId?, careUnitId?, topic?, description,
// receivedOn, assignedTo? }); die Frist ergibt sich aus der Antwortfrist der Einrichtung (ausser bei Lob).
export async function recordFeedback(ctx: ApiContext, body: Record<string, unknown>) {
  if (!canRecord(ctx)) throw new ApiError("Keine Berechtigung.", 403);
  const kind = String(body.kind ?? "");
  if (!(kind in FEEDBACK_KINDS)) throw new ApiError("Bitte die Art wählen.");
  const source = String(body.source ?? "");
  if (!(source in FEEDBACK_SOURCES)) throw new ApiError("Bitte angeben, von wem die Rückmeldung kommt.");
  const channel = String(body.channel ?? "");
  if (!(channel in FEEDBACK_CHANNELS)) throw new ApiError("Bitte den Weg wählen.");
  const description = text(body.description, 4000);
  if (!description) throw new ApiError("Bitte die Rückmeldung beschreiben.");
  const { today, responseDays } = await context(ctx);
  const receivedOn = day(body.receivedOn, "Das Eingangsdatum");
  if (!receivedOn) throw new ApiError("Bitte das Eingangsdatum angeben.");
  if (receivedOn > today) throw new ApiError("Das Eingangsdatum liegt in der Zukunft.");
  const refs = await references(ctx, body);
  if (refs.assignedTo && !canManage(ctx))
    throw new ApiError("Die Zuständigkeit legt das Qualitätsmanagement fest.", 403);
  const id = randomUUID();
  const data = {
    kind,
    source,
    sourceName: text(body.sourceName, 200),
    contact: text(body.contact, 200),
    channel,
    topic: text(body.topic, 120),
    description,
    receivedOn,
  };
  const dueDays = kind === "praise" ? null : responseDays;
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_feedback (id, organization_id, kind, source, source_name, contact, channel, resident_id,
        care_unit_id, topic, description, received_on, due_on, assigned_to, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${kind}, ${source}, ${data.sourceName}, ${data.contact}, ${channel},
        ${refs.residentId}, ${refs.careUnitId}, ${data.topic}, ${description}, ${receivedOn},
        CASE WHEN ${dueDays}::int IS NULL THEN NULL ELSE ${receivedOn}::date + ${dueDays}::int END,
        ${refs.assignedTo}, ${ctx.actor.id})`,
    auditStatement(ctx, "feedback", id, "recorded", null, { ...data, residentId: refs.residentId }),
    ...assignNotice(ctx, refs.assignedTo, id, kind as FeedbackKind, data.topic),
  ]);
  return { id };
}

// Bearbeiten ({ action }): "update" (Thema, Zuständigkeit, Massnahmen, in Bearbeitung), "answer" ({ response,
// answeredOn }), "close", "reopen". Qualitätsmanagement oder die zuständige Person; Zuständigkeit nur das QM.
export async function updateFeedback(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const id = assertUuid(idInput, "Rückmeldung");
  const [row] = (await ctx.sql`
    SELECT f.*, to_char(f.received_on, 'YYYY-MM-DD') AS received_day, f.updated_at::text AS stamp
    FROM carecore_feedback f WHERE f.id = ${id} AND f.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Rückmeldung nicht gefunden.", 404);
  const manage = canManage(ctx);
  if (!manage && row.assigned_to !== ctx.actor.id) throw new ApiError("Keine Berechtigung.", 403);
  const action = String(body.action ?? "");
  const status = row.status as FeedbackStatus;
  const { today } = await context(ctx);
  let statements: Array<ReturnType<ApiContext["sql"]>>;
  if (action === "update") {
    if (status === "closed") throw new ApiError("Die Rückmeldung ist abgeschlossen.", 409);
    const assignedTo = manage
      ? (await references(ctx, { assignedTo: body.assignedTo })).assignedTo
      : ((row.assigned_to as string | null) ?? null);
    const data = {
      topic: text(body.topic, 120),
      measures: text(body.measures, 4000),
      assignedTo,
      status: status === "open" && body.inProgress === true ? "in_progress" : status,
    };
    statements = [
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_feedback SET topic = ${data.topic}, measures = ${data.measures}, assigned_to = ${assignedTo},
          status = ${data.status}, updated_at = NOW()
        WHERE id = ${id} AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'FEEDBACK_CHANGED')`,
      auditStatement(
        ctx,
        "feedback",
        id,
        "updated",
        { topic: row.topic, measures: row.measures, assignedTo: row.assigned_to, status },
        data,
      ),
      ...(assignedTo !== row.assigned_to
        ? assignNotice(ctx, assignedTo, id, row.kind as FeedbackKind, data.topic)
        : []),
    ];
  } else if (action === "answer") {
    if (status === "closed") throw new ApiError("Die Rückmeldung ist abgeschlossen.", 409);
    const response = text(body.response, 4000);
    if (!response) throw new ApiError("Bitte die Antwort festhalten.");
    const answeredOn = day(body.answeredOn, "Das Datum der Antwort");
    if (!answeredOn) throw new ApiError("Bitte das Datum der Antwort angeben.");
    if (answeredOn > today) throw new ApiError("Das Datum der Antwort liegt in der Zukunft.");
    if (answeredOn < String(row.received_day)) throw new ApiError("Die Antwort liegt vor dem Eingang.");
    statements = [
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_feedback SET response = ${response}, answered_on = ${answeredOn}, answered_by = ${ctx.actor.id},
          status = 'answered', updated_at = NOW()
        WHERE id = ${id} AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'FEEDBACK_CHANGED')`,
      auditStatement(ctx, "feedback", id, "answered", null, { response, answeredOn }),
    ];
  } else if (action === "close") {
    if (!manage) throw new ApiError("Abschliessen kann das Qualitätsmanagement.", 403);
    if (status === "closed") throw new ApiError("Die Rückmeldung ist bereits abgeschlossen.", 409);
    if (row.kind !== "praise" && !row.answered_on)
      throw new ApiError("Bitte zuerst die Antwort festhalten (bei Lob nicht nötig).", 409);
    statements = [
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_feedback SET status = 'closed', closed_at = NOW(), closed_by = ${ctx.actor.id}, updated_at = NOW()
        WHERE id = ${id} AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'FEEDBACK_CHANGED')`,
      auditStatement(ctx, "feedback", id, "closed", null, { kind: row.kind }),
    ];
  } else if (action === "reopen") {
    if (!manage) throw new ApiError("Wieder öffnen kann das Qualitätsmanagement.", 403);
    if (status !== "closed") throw new ApiError("Die Rückmeldung ist nicht abgeschlossen.", 409);
    statements = [
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_feedback SET status = CASE WHEN answered_on IS NULL THEN 'in_progress' ELSE 'answered' END,
          closed_at = NULL, closed_by = NULL, updated_at = NOW()
        WHERE id = ${id} AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'FEEDBACK_CHANGED')`,
      auditStatement(ctx, "feedback", id, "reopened", null, { kind: row.kind }),
    ];
  } else throw new ApiError("Ungültige Angabe.");
  await ctx.sql.transaction(statements).catch((error) => {
    if (String(error).includes("FEEDBACK_CHANGED"))
      throw new ApiError("Die Rückmeldung wurde inzwischen geändert. Bitte neu laden.", 409);
    throw error;
  });
}

// Erinnerung beim Laden der Benachrichtigungen: Frist abgelaufen und noch nicht beantwortet; an die zuständige Person,
// ohne Zuständigkeit an das Qualitätsmanagement; je Rückmeldung einmal.
export async function createFeedbackReminders(ctx: ApiContext) {
  const manage = canManage(ctx);
  await ctx.sql`
    WITH due AS (
      SELECT f.id, f.kind, f.topic, f.due_on FROM carecore_feedback f
      JOIN carecore_organizations o ON o.id = f.organization_id
      WHERE f.organization_id = ${ctx.actor.organizationId} AND f.status IN ('open', 'in_progress')
        AND f.due_on IS NOT NULL AND f.due_on < (NOW() AT TIME ZONE o.timezone)::date
        AND (f.assigned_to = ${ctx.actor.id} OR (f.assigned_to IS NULL AND ${manage})))
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id},
      CASE due.kind WHEN 'complaint' THEN 'Beschwerde' ELSE 'Rückmeldung' END || ' noch nicht beantwortet',
      'Antwortfrist der Einrichtung seit ' || to_char(due.due_on, 'DD.MM.YYYY') || ' abgelaufen'
        || CASE WHEN due.topic <> '' THEN ' · ' || due.topic ELSE '' END || '.',
      'feedback_overdue', 'normal', ${LINK}, 'feedback', due.id
    FROM due
    WHERE NOT EXISTS (SELECT 1 FROM carecore_notifications n
      WHERE n.user_id = ${ctx.actor.id} AND n.type = 'feedback_overdue' AND n.entity_id = due.id)`;
}
