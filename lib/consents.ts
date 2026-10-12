import { randomUUID } from "node:crypto";
import {
  ApiError,
  assertResident,
  assertUuid,
  auditStatement,
  text,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  CONSENT_DECISIONS,
  CONSENT_TOPICS_MAX,
  type ConsentDecision,
  type ConsentEntry,
  type ConsentList,
  type ConsentOverview,
  type ConsentStatus,
} from "@/lib/consents-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

async function today(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(row.day);
}

// Themen der Einrichtung (Leitung · Konfiguration); leer, bis die Einrichtung welche festlegt.
const resolveTopics = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim())
    : [];

export async function readConsentTopics(ctx: ApiContext) {
  const rows =
    await ctx.sql`SELECT settings->'consentTopics' AS topics FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return resolveTopics(rows[0]?.topics);
}

export async function saveConsentTopics(ctx: ApiContext, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  if (!Array.isArray(body.topics) || !body.topics.every((item) => typeof item === "string"))
    throw new ApiError("Bitte die Themen angeben.");
  const topics = (body.topics as string[]).map((item) => item.trim()).filter(Boolean);
  if (topics.length > CONSENT_TOPICS_MAX) throw new ApiError(`Höchstens ${CONSENT_TOPICS_MAX} Themen möglich.`);
  if (topics.some((item) => item.length > 160)) throw new ApiError("Ein Thema hat höchstens 160 Zeichen.");
  if (new Set(topics.map((item) => item.toLowerCase())).size !== topics.length)
    throw new ApiError("Jedes Thema darf nur einmal vorkommen.");
  const before = await readConsentTopics(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{consentTopics}', ${JSON.stringify(topics)}::jsonb),
        updated_at = NOW()
      WHERE id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "setting", ctx.actor.organizationId, "consent_topics", { topics: before }, { topics }),
  ]);
  return topics;
}

const toEntry = (row: Row): ConsentEntry => ({
  id: String(row.id),
  topic: String(row.topic),
  decision: row.decision as ConsentDecision,
  decidedBy: String(row.decided_by),
  decidedOn: String(row.decided_day),
  note: String(row.note),
  recordedBy: (row.recorded_by as string | null) ?? null,
  revoked: row.revoked_day
    ? { on: String(row.revoked_day), by: (row.revoked_by_name as string | null) ?? null, note: String(row.revoke_note) }
    : null,
});

const statusOf = (entry: ConsentEntry | null): ConsentStatus =>
  !entry ? "missing" : entry.revoked ? "revoked" : entry.decision;

export async function consentList(ctx: ApiContext, residentInput: unknown): Promise<ConsentList> {
  const residentId = await assertResident(ctx, residentInput);
  const [rows, topics] = await Promise.all([
    ctx.sql`
      SELECT c.*, to_char(c.decided_on, 'YYYY-MM-DD') AS decided_day, to_char(c.revoked_on, 'YYYY-MM-DD') AS revoked_day,
        u.display_name AS recorded_by, r.display_name AS revoked_by_name
      FROM carecore_resident_consents c
      LEFT JOIN carecore_users u ON u.id = c.created_by
      LEFT JOIN carecore_users r ON r.id = c.revoked_by
      WHERE c.resident_id = ${residentId}
      ORDER BY c.decided_on DESC, c.created_at DESC` as Promise<Row[]>,
    readConsentTopics(ctx),
  ]);
  const history = rows.map(toEntry);
  const latest = (topic: string) => history.find((entry) => entry.topic.toLowerCase() === topic.toLowerCase()) ?? null;
  const names = [
    ...topics,
    ...history
      .map((entry) => entry.topic)
      .filter(
        (topic, index, all) =>
          !topics.some((item) => item.toLowerCase() === topic.toLowerCase()) &&
          all.findIndex((other) => other.toLowerCase() === topic.toLowerCase()) === index,
      ),
  ];
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    topics: names.map((topic) => {
      const current = latest(topic);
      return { topic, status: statusOf(current), current };
    }),
    history,
  };
}

// Entscheid erfassen ({ topic, decision, decidedBy, decidedOn, note? }); ein neuer Entscheid ersetzt den alten nicht,
// sondern gilt ab seinem Datum.
export async function recordConsent(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const topic = text(body.topic, 160);
  if (!topic) throw new ApiError("Bitte das Thema angeben.");
  const decision = String(body.decision ?? "");
  if (!(decision in CONSENT_DECISIONS)) throw new ApiError("Bitte „zugestimmt“ oder „abgelehnt“ wählen.");
  const decidedBy = text(body.decidedBy, 200);
  if (!decidedBy) throw new ApiError("Bitte angeben, wer entschieden hat (Person selbst oder Vertretung).");
  const decidedOn = typeof body.decidedOn === "string" && DATE.test(body.decidedOn) ? body.decidedOn : null;
  if (!decidedOn) throw new ApiError("Bitte das Datum angeben.");
  if (decidedOn > (await today(ctx))) throw new ApiError("Das Datum liegt in der Zukunft.");
  const data = { topic, decision, decidedBy, decidedOn, note: text(body.note, 2000) };
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_consents (id, organization_id, resident_id, topic, decision, decided_by, decided_on,
        note, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${topic}, ${decision}, ${decidedBy}, ${decidedOn},
        ${data.note}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_consent",
      entityId: id,
      action: "recorded",
      after: data,
    }),
  ]);
  return consentList(ctx, residentId);
}

// Widerruf ({ revokedOn, note? }) eines geltenden Entscheids.
export async function revokeConsent(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(idInput, "Eintrag");
  const revokedOn = typeof body.revokedOn === "string" && DATE.test(body.revokedOn) ? body.revokedOn : null;
  if (!revokedOn) throw new ApiError("Bitte das Datum des Widerrufs angeben.");
  const [row] = (await ctx.sql`
    SELECT c.*, to_char(c.decided_on, 'YYYY-MM-DD') AS decided_day FROM carecore_resident_consents c
    WHERE c.id = ${id} AND c.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Eintrag nicht gefunden.", 404);
  if (row.revoked_on) throw new ApiError("Der Entscheid ist bereits widerrufen.", 409);
  if (revokedOn > (await today(ctx))) throw new ApiError("Das Datum liegt in der Zukunft.");
  if (revokedOn < String(row.decided_day)) throw new ApiError("Der Widerruf liegt vor dem Entscheid.");
  const note = text(body.note, 500);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_resident_consents SET revoked_on = ${revokedOn}, revoked_by = ${ctx.actor.id}, revoke_note = ${note}
          WHERE id = ${id} AND revoked_on IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'CONSENT_REVOKED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(row.resident_id),
        entityType: "resident_consent",
        entityId: id,
        action: "revoked",
        after: { topic: row.topic, revokedOn, note },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("CONSENT_REVOKED")) throw new ApiError("Der Entscheid ist bereits widerrufen.", 409);
      throw error;
    });
  return consentList(ctx, String(row.resident_id));
}

// Übersicht je Wohnbereich zu einem Thema: Stand je Person mit laufendem Aufenthalt.
export async function consentOverview(ctx: ApiContext, topicInput: unknown): Promise<ConsentOverview> {
  const topics = await readConsentTopics(ctx);
  const topic = text(topicInput, 160) || topics[0] || "";
  const org = ctx.actor.organizationId;
  const [units, rows] = (await Promise.all([
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name`,
    ctx.sql`
      SELECT r.id, r.last_name || ' ' || r.first_name AS name, COALESCE(ro.name, '') AS room, st.care_unit_id,
        c.decision, to_char(c.decided_on, 'YYYY-MM-DD') AS decided_day, to_char(c.revoked_on, 'YYYY-MM-DD') AS revoked_day
      FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN LATERAL (
        SELECT decision, decided_on, revoked_on FROM carecore_resident_consents
        WHERE resident_id = r.id AND lower(topic) = lower(${topic})
        ORDER BY decided_on DESC, created_at DESC LIMIT 1) c ON TRUE
      WHERE r.organization_id = ${org} AND st.ended_at IS NULL AND r.status = 'active'
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name`,
  ])) as Row[][];
  return {
    topic,
    topics,
    units: units
      .map((unit) => ({
        id: String(unit.id),
        name: String(unit.name),
        residents: rows
          .filter((row) => row.care_unit_id === unit.id)
          .map((row) => ({
            id: String(row.id),
            name: String(row.name),
            room: String(row.room),
            status: (!row.decision ? "missing" : row.revoked_day ? "revoked" : row.decision) as ConsentStatus,
            since: ((row.revoked_day ?? row.decided_day) as string | null) ?? null,
          })),
      }))
      .filter((unit) => unit.residents.length > 0),
  };
}
