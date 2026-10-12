import { randomUUID } from "node:crypto";
import { iso, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { initials } from "@/lib/medication-shared";
import { readSettings } from "@/lib/settings";
import { KOMPASS_DOMAINS, KOMPASS_INSTRUMENT } from "@/lib/kompass-instrument";
import { type RaiPerson, type RaiResidentRow, type RaiState, type RaiWorkplace } from "@/lib/rai-shared";

// Kompass-Arbeitsplatz: Arbeitskorb, Verantwortliche und Fälligkeiten der Abklärungen mit dem CareOS Kompass
// (Erfassung selbst in lib/kompass.ts). Fristen legt die Einrichtung in den Einstellungen fest.

export const day = (value: unknown) => (value ? (iso(value) ?? "").slice(0, 10) : null);

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

// Mitarbeitende, deren Rolle Abklärungen mit dem Kompass durchführen darf, mit ihren offenen Abklärungen.
export async function raiPeople(ctx: ApiContext): Promise<RaiPerson[]> {
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name, COALESCE(p.last_seen_at > NOW() - INTERVAL '15 minutes', FALSE) AS online,
      (SELECT COUNT(*) FROM carecore_rai_assessments a WHERE a.responsible_user_id = u.id
        AND a.status IN ('new', 'in_progress', 'overdue'))::int AS open
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    JOIN carecore_roles ro ON ro.key = u.role
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.archived_at IS NULL
      AND ro.permissions ? 'rai.manage'
    ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    initials: initials(String(row.display_name)),
    openAssessments: Number(row.open),
    online: Boolean(row.online),
  }));
}

export async function raiWorkplace(ctx: ApiContext): Promise<RaiWorkplace> {
  const org = ctx.actor.organizationId;
  const [rows, people, settings] = await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, r.admitted_on, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit,
        cu.id AS care_unit_id, (NOW() AT TIME ZONE o.timezone)::date AS today,
        open.id AS open_id, open.status AS open_status, open.due_on AS open_due, open.progress AS open_progress,
        open.assessment_type AS open_type, open.responsible_user_id AS open_user, ou.display_name AS open_user_name,
        done.completed_at AS done_at, done.due_on AS done_due, done.assessment_type AS done_type, done.data AS done_data,
        done.responsible_user_id AS done_user, du.display_name AS done_user_name
      FROM carecore_residents r
      JOIN carecore_organizations o ON o.id = r.organization_id
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN LATERAL (SELECT * FROM carecore_rai_assessments WHERE resident_id = r.id AND status IN ('new', 'in_progress', 'overdue')
        ORDER BY (status = 'in_progress') DESC, updated_at DESC LIMIT 1) open ON TRUE
      LEFT JOIN carecore_users ou ON ou.id = open.responsible_user_id
      LEFT JOIN LATERAL (SELECT * FROM carecore_rai_assessments WHERE resident_id = r.id AND status = 'current'
        ORDER BY completed_at DESC NULLS LAST LIMIT 1) done ON TRUE
      LEFT JOIN carecore_users du ON du.id = done.responsible_user_id
      WHERE r.organization_id = ${org} AND r.status = 'active'
      ORDER BY cu.name NULLS LAST, ro.name NULLS LAST, r.last_name, r.first_name` as Promise<Row[]>,
    raiPeople(ctx),
    readSettings(ctx),
  ]);
  const admissionDays =
    settings.kompassAdmissionDays.enabled && settings.kompassAdmissionDays.value
      ? settings.kompassAdmissionDays.value
      : null;
  const intervalMonths =
    settings.kompassIntervalMonths.enabled && settings.kompassIntervalMonths.value
      ? settings.kompassIntervalMonths.value
      : null;

  const residents: RaiResidentRow[] = rows.map((row) => {
    const today = day(row.today) ?? new Date().toISOString().slice(0, 10);
    const completed = day(row.done_at);
    const draft = row.open_status === "in_progress";
    // Ohne Fristen der Einrichtung wird nichts automatisch fällig.
    const firstDue = admissionDays && row.admitted_on ? addDays(day(row.admitted_on) ?? today, admissionDays) : null;
    const dueOn =
      day(row.open_due) ??
      day(row.done_due) ??
      (completed ? (intervalMonths ? addMonths(completed, intervalMonths) : null) : firstDue);
    let state: RaiState;
    if (draft) state = "in_progress";
    else if (dueOn && dueOn < today) state = "overdue";
    else if (!completed) state = "new";
    else if (dueOn && dueOn <= addDays(today, 14)) state = "due";
    else state = "current";
    const doneData = (row.done_data && typeof row.done_data === "object" ? row.done_data : {}) as Record<
      string,
      unknown
    >;
    const doneDomains = (doneData.domains && typeof doneData.domains === "object" ? doneData.domains : {}) as Record<
      string,
      { need?: boolean }
    >;
    const name = `${row.first_name} ${row.last_name}`;
    return {
      id: String(row.id),
      name,
      initials: initials(name),
      room: String(row.room),
      unit: String(row.unit),
      careUnitId: row.care_unit_id ? String(row.care_unit_id) : null,
      state,
      reason: draft
        ? "Offene Bereiche abschliessen"
        : completed
          ? intervalMonths
            ? `Folgeabklärung (alle ${intervalMonths} Monate)`
            : "Folgeabklärung nach Bedarf"
          : "Erste Abklärung nach Eintritt",
      dueOn,
      progress: draft ? Number(row.open_progress ?? 0) : completed ? 100 : 0,
      instrument: row.open_type ? String(row.open_type) : row.done_type ? String(row.done_type) : null,
      assessorId: row.open_user ? String(row.open_user) : row.done_user ? String(row.done_user) : null,
      assessor: row.open_user_name
        ? String(row.open_user_name)
        : row.done_user_name
          ? String(row.done_user_name)
          : null,
      draftId: draft ? String(row.open_id) : null,
      lastCompletedOn: completed,
      // Bereiche mit Handlungsbedarf laut der letzten abgeschlossenen Abklärung (Entscheid der Fachperson).
      needs:
        completed && row.done_type === KOMPASS_INSTRUMENT
          ? KOMPASS_DOMAINS.filter((domain) => doneDomains[domain.id]?.need).length
          : null,
    };
  });
  const current = residents.filter((row) => row.state === "current" || row.state === "due").length;
  return {
    residents,
    people,
    summary: {
      records: residents.filter((row) => row.lastCompletedOn || row.draftId).length,
      due: residents.filter((row) => row.state === "due" || row.state === "overdue" || row.state === "new").length,
      currentShare: residents.length ? Math.round((current / residents.length) * 100) : 0,
      responsible: people.length,
      drafts: residents.filter((row) => row.draftId).length,
    },
  };
}

// Heutiges Datum in der Zeitzone der Organisation.
export async function orgToday(ctx: ApiContext) {
  const rows =
    (await ctx.sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0].d);
}

// Plant fällige Abklärungen: je Person ohne offene Abklärung ein geplanter Eintrag; auf Wunsch werden die
// Verantwortlichen benachrichtigt.
export async function refreshRaiDue(ctx: ApiContext, body: Record<string, unknown>) {
  const scope = String(body.scope ?? "all");
  const days = Math.min(Math.max(Number(body.days) || 30, 0), 120);
  const unitIds = Array.isArray(body.unitIds) ? body.unitIds.map(String) : null;
  const workplace = await raiWorkplace(ctx);
  const today = await orgToday(ctx);
  const limit = addDays(today, days);
  const candidates = workplace.residents.filter(
    (row) =>
      row.state !== "current" &&
      row.state !== "in_progress" &&
      row.dueOn !== null &&
      row.dueOn <= limit &&
      (!unitIds || (row.careUnitId !== null && unitIds.includes(row.careUnitId))) &&
      (scope === "overdue" ? row.state === "overdue" : scope === "new" ? !row.lastCompletedOn : true),
  );
  const existing = new Set(
    (
      (await ctx.sql`
        SELECT resident_id FROM carecore_rai_assessments
        WHERE status IN ('new', 'overdue') AND resident_id = ANY(${candidates.map((row) => row.id)})`) as Row[]
    ).map((row) => String(row.resident_id)),
  );
  const planned = candidates.filter((row) => !existing.has(row.id));
  const statements = planned.map(
    (row) => ctx.sql`
      INSERT INTO carecore_rai_assessments (id, resident_id, responsible_user_id, assessment_type, status, due_on, progress)
      VALUES (${randomUUID()}, ${row.id}, ${row.assessorId}, ${KOMPASS_INSTRUMENT}, 'new', ${row.dueOn}, 0)`,
  );
  // Planned entries whose date has passed are marked overdue.
  statements.push(ctx.sql`
    UPDATE carecore_rai_assessments a SET status = 'overdue', updated_at = NOW()
    FROM carecore_residents r
    WHERE r.id = a.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      AND a.status = 'new' AND a.due_on < ${today}::date`);
  let notified = 0;
  if (body.notify === true && candidates.length)
    for (const person of workplace.people.filter((person) => person.id !== ctx.actor.id)) {
      statements.push(ctx.sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
        VALUES (${randomUUID()}, ${person.id}, ${`${candidates.length} Abklärung${candidates.length === 1 ? "" : "en"} mit dem Kompass fällig`},
          ${`${ctx.actor.display_name} hat die Fälligkeiten des Kompass aktualisiert.`}, 'rai_due', 'normal', '/c/kompass/faelligkeiten')`);
      notified += 1;
    }
  statements.push(
    auditStatement(ctx, "rai_due", ctx.actor.organizationId, "refreshed", null, {
      scope,
      days,
      planned: planned.length,
      due: candidates.length,
    }),
  );
  await ctx.sql.transaction(statements);
  return { due: candidates.length, planned: planned.length, notified };
}
