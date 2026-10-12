import { randomUUID } from "node:crypto";
import { readTerms } from "@/lib/settings";
import { ApiError, assertResident, iso, text, auditStatement, type ApiContext, type Row } from "@/lib/api-context";
import { initials } from "@/lib/medication-shared";
import { deathChecklistSnapshot } from "@/lib/end-of-life";
import {
  EXIT_KINDS,
  LIFECYCLE_LABELS,
  type ExitKind,
  type HistoryDetail,
  type HistoryResident,
  type HistoryTone,
} from "@/lib/resident-history-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function toneOf(row: Row): HistoryTone {
  if (["discharged", "deceased", "archived"].includes(String(row.status))) return "archived";
  if (row.status !== "active") return "info";
  if (row.flag_severity === "critical") return "critical";
  if (row.flag_severity === "attention") return "attention";
  return "stable";
}

// All residents of the organization, current and former, with their last stay and entry.
export async function historyOverview(ctx: ApiContext) {
  const [rows, units] = (await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, r.status,
        to_char(COALESCE(r.admitted_on, (first_stay.started_at AT TIME ZONE org.tz)::date), 'YYYY-MM-DD') AS admitted_on,
        to_char(COALESCE(r.deceased_on, r.discharged_on), 'YYYY-MM-DD') AS ended_on,
        COALESCE(cu.name, '') AS care_unit, COALESCE(ro.name, '') AS room,
        flag.severity AS flag_severity,
        doc.title AS doc_title, doc.category AS doc_category, doc.body AS doc_body, doc.occurred_at AS doc_at, doc.author AS doc_author,
        (SELECT COUNT(*)::int FROM carecore_documentation_entries d WHERE d.resident_id = r.id) AS entry_count
      FROM carecore_residents r
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id
        ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN LATERAL (SELECT started_at FROM carecore_resident_stays WHERE resident_id = r.id ORDER BY started_at LIMIT 1) first_stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN LATERAL (SELECT severity FROM carecore_resident_clinical_flags WHERE resident_id = r.id AND active
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END LIMIT 1) flag ON TRUE
      LEFT JOIN LATERAL (SELECT d.title, d.category, d.body, d.occurred_at,
        COALESCE(u.display_name, d.metadata ->> 'portalAuthor') AS author
        FROM carecore_documentation_entries d LEFT JOIN carecore_users u ON u.id = d.author_user_id
        WHERE d.resident_id = r.id ORDER BY d.occurred_at DESC LIMIT 1) doc ON TRUE
      WHERE r.organization_id = ${ctx.actor.organizationId}
      ORDER BY (r.status IN ('active', 'planned', 'transferred')) DESC, r.last_name, r.first_name`,
    ctx.sql`
      SELECT cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${ctx.actor.organizationId} AND cu.active ORDER BY cu.name`,
  ])) as [Row[], Row[]];
  return {
    units: units.map((row) => String(row.name)),
    residents: rows.map((row): HistoryResident => {
      const name = `${row.first_name} ${row.last_name}`;
      return {
        id: String(row.id),
        name,
        initials: initials(name),
        room: String(row.room),
        careUnit: String(row.care_unit),
        status: LIFECYCLE_LABELS[String(row.status)] ?? "Aktiv",
        tone: toneOf(row),
        admittedOn: (row.admitted_on as string | null) ?? null,
        endedOn: (row.ended_on as string | null) ?? null,
        lastEntry: row.doc_at
          ? {
              title: String(row.doc_title ?? row.doc_category),
              body: String(row.doc_body),
              occurredAt: iso(row.doc_at) ?? "",
              author: (row.doc_author as string | null) ?? null,
            }
          : null,
        entryCount: Number(row.entry_count ?? 0),
      };
    }),
  };
}

export async function historyDetail(ctx: ApiContext, residentIdInput: unknown): Promise<HistoryDetail> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [stays, entries] = (await Promise.all([
    ctx.sql`
      SELECT s.id, COALESCE(cu.name, '') AS care_unit, COALESCE(ro.name, '') AS room, s.started_at, s.ended_at
      FROM carecore_resident_stays s
      LEFT JOIN carecore_care_units cu ON cu.id = s.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = s.room_id
      WHERE s.resident_id = ${residentId} ORDER BY s.started_at DESC`,
    ctx.sql`
      SELECT d.id, d.title, d.category, d.body, d.importance, d.occurred_at,
        COALESCE(u.display_name, d.metadata ->> 'portalAuthor') AS author
      FROM carecore_documentation_entries d LEFT JOIN carecore_users u ON u.id = d.author_user_id
      WHERE d.resident_id = ${residentId} ORDER BY d.occurred_at DESC LIMIT 8`,
  ])) as [Row[], Row[]];
  return {
    stays: stays.map((row) => ({
      id: String(row.id),
      careUnit: String(row.care_unit),
      room: String(row.room),
      startedAt: iso(row.started_at) ?? "",
      endedAt: iso(row.ended_at),
    })),
    entries: entries.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? row.category),
      body: String(row.body),
      category: String(row.category),
      importance: String(row.importance),
      occurredAt: iso(row.occurred_at) ?? "",
      author: (row.author as string | null) ?? null,
    })),
  };
}

async function loadResident(ctx: ApiContext, residentIdInput: unknown) {
  const residentId = await assertResident(ctx, residentIdInput);
  const rows = (await ctx.sql`
    SELECT r.id, r.status, r.first_name, r.last_name, to_char(r.admitted_on, 'YYYY-MM-DD') AS admitted_on,
      to_char(NOW() AT TIME ZONE org.timezone, 'YYYY-MM-DD') AS today, org.timezone AS tz
    FROM carecore_residents r JOIN carecore_organizations org ON org.id = r.organization_id
    WHERE r.id = ${residentId}`) as Row[];
  return rows[0];
}

function parseDay(value: unknown, row: Row, label: string) {
  const day = typeof value === "string" && DATE.test(value) ? value : null;
  if (!day) throw new ApiError(`Bitte das ${label} angeben.`);
  if (day > String(row.today)) throw new ApiError(`Das ${label} darf nicht in der Zukunft liegen.`);
  if (row.admitted_on && day < String(row.admitted_on)) throw new ApiError(`Das ${label} liegt vor dem Eintritt.`);
  return day;
}

// Ends the current stay: discharge and death close the stay and the open care plan;
// an external transfer keeps the room reserved until the resident returns.
export async function recordExit(ctx: ApiContext, residentIdInput: unknown, body: Record<string, unknown>) {
  const resident = await loadResident(ctx, residentIdInput);
  const kind = body.kind as ExitKind;
  if (!(kind in EXIT_KINDS)) throw new ApiError("Bitte die Art des Austritts wählen.");
  if (resident.status !== "active") throw new ApiError("Nur aktive Aufenthalte können beendet werden.", 409);
  const day = parseDay(body.date, resident, EXIT_KINDS[kind].dateLabel);
  const note = text(body.note, 2000);
  if (!note) throw new ApiError("Bitte eine kurze Notiz zum Verlauf erfassen.");
  const closes = kind !== "transferred";
  const label = EXIT_KINDS[kind].label;
  const endedAt = `${day} 12:00`;
  const residentId = String(resident.id);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance)
      SELECT ${randomUUID()}, ${residentId},
        (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1),
        ${ctx.actor.id}, 'Sonstiges', ${label}, ${note},
        CASE WHEN ${day}::date = (NOW() AT TIME ZONE ${resident.tz})::date THEN NOW() ELSE (${endedAt}::timestamp AT TIME ZONE ${resident.tz}) END,
        'important'`,
    ctx.sql`
      UPDATE carecore_residents SET status = ${kind},
        discharged_on = CASE WHEN ${kind} = 'deceased' THEN discharged_on ELSE ${day}::date END,
        deceased_on = CASE WHEN ${kind} = 'deceased' THEN ${day}::date ELSE deceased_on END,
        updated_at = NOW()
      WHERE id = ${residentId}`,
    ctx.sql`
      UPDATE carecore_resident_stays
      SET ended_at = GREATEST(started_at, CASE WHEN ${day}::date = (NOW() AT TIME ZONE ${resident.tz})::date THEN NOW()
        ELSE ${endedAt}::timestamp AT TIME ZONE ${resident.tz} END)
      WHERE resident_id = ${residentId} AND ended_at IS NULL AND ${closes}`,
    ctx.sql`
      UPDATE carecore_care_plans SET status = 'closed', closed_at = NOW(), closed_reason = ${label}, updated_at = NOW()
      WHERE resident_id = ${residentId} AND status IN ('draft', 'active', 'review') AND ${closes}`,
    // Todesfall: die Checkliste der Einrichtung für die Person übernehmen (leer, solange keine festgelegt ist).
    ...(kind === "deceased" ? [deathChecklistSnapshot(ctx.sql, ctx.actor.organizationId, residentId)] : []),
    auditStatement(
      ctx,
      "resident",
      residentId,
      `stay_${kind}`,
      { status: resident.status },
      { status: kind, date: day, note },
    ),
  ]);
  return `${label} von ${resident.first_name} ${resident.last_name} erfasst`;
}

// Return after an external transfer; the reserved stay continues.
export async function recordReturn(ctx: ApiContext, residentIdInput: unknown, body: Record<string, unknown>) {
  const resident = await loadResident(ctx, residentIdInput);
  if (resident.status !== "transferred")
    throw new ApiError(`Nur verlegte ${(await readTerms(ctx)).many} können zurückkehren.`, 409);
  const day = parseDay(body.date, resident, "Rückkehrdatum");
  const note = text(body.note, 2000) || "Rückkehr nach externer Verlegung.";
  const residentId = String(resident.id);
  const stays =
    await ctx.sql`SELECT id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL LIMIT 1`;
  if (!stays[0]) throw new ApiError("Kein reservierter Aufenthalt vorhanden. Bitte den Eintritt neu erfassen.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance)
      SELECT ${randomUUID()}, ${residentId},
        (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1),
        ${ctx.actor.id}, 'Sonstiges', 'Rückkehr', ${note},
        CASE WHEN ${day}::date = (NOW() AT TIME ZONE ${resident.tz})::date THEN NOW() ELSE (${`${day} 12:00`}::timestamp AT TIME ZONE ${resident.tz}) END,
        'important'`,
    ctx.sql`UPDATE carecore_residents SET status = 'active', discharged_on = NULL, updated_at = NOW() WHERE id = ${residentId}`,
    auditStatement(
      ctx,
      "resident",
      residentId,
      "stay_returned",
      { status: resident.status },
      { status: "active", date: day },
    ),
  ]);
  return `Rückkehr von ${resident.first_name} ${resident.last_name} erfasst`;
}
