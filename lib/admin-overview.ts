import { iso, type ApiContext, type Row } from "@/lib/api-context";
import { readTerms } from "@/lib/settings";
import { AUDIT_AREAS, UUID, auditArea, auditChanges, auditSettingTitle, auditTitle } from "@/lib/audit-labels";
import { readSettings } from "@/lib/settings";
import { SETTING_DEFINITIONS, type SettingKey } from "@/lib/settings-shared";

// Lower part of the administration pages: development of the last six weeks,
// open administrative to-dos and the change log.

export type AdminView = "organization" | "users" | "configuration";
type Tone = "stable" | "attention" | "critical" | "info";

export type AdminPriority = { id: string; title: string; detail: string; tone: Tone; href: string };
export type AdminLogEntry = {
  id: string;
  at: string;
  actor: string;
  area: string;
  title: string;
  subject: string;
  changes: Array<{ field: string; before: string; after: string }>;
  href: string | null;
};
export type AdminOverview = {
  trend: { title: string; subtitle: string; labels: [string, string, string]; series: number[][]; weeks: string[] };
  priorities: AdminPriority[];
  log: AdminLogEntry[];
};

function residentOf(row: Row) {
  for (const data of [row.after_data, row.before_data])
    if (data && typeof data === "object") {
      const value = (data as Record<string, unknown>).residentId;
      if (typeof value === "string" && UUID.test(value)) return value;
    }
  return row.entity_type === "resident" && UUID.test(String(row.entity_id ?? "")) ? String(row.entity_id) : null;
}

function subject(row: Row) {
  if (row.entity_type === "setting") return auditSettingTitle(String(row.action));
  for (const data of [row.after_data, row.before_data])
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      const value = record.name ?? record.title ?? record.displayName ?? record.display_name ?? record.username;
      if (typeof value === "string" && value) return value;
    }
  return typeof row.entity_name === "string" ? row.entity_name : "";
}

const VIEW_TYPES: Record<AdminView, string[] | null> = {
  organization: ["site", "care_unit"],
  users: ["user", "role"],
  configuration: null,
};

export async function adminOverview(ctx: ApiContext, view: AdminView): Promise<AdminOverview> {
  const org = ctx.actor.organizationId;
  const types = VIEW_TYPES[view];
  const [weeks, logRows, todo, settings, t] = await Promise.all([
    trendRows(ctx, view),
    ctx.sql`
      SELECT a.id, a.created_at, a.entity_type, a.entity_id, a.action, a.before_data, a.after_data, COALESCE(u.display_name, a.after_data ->> 'portalActor', 'System') AS actor,
        CASE
          WHEN a.entity_type IN ('user', 'user_mfa') THEN (SELECT display_name FROM carecore_users WHERE id = a.entity_id)
          WHEN a.entity_type = 'task' THEN (SELECT title FROM carecore_tasks WHERE id = a.entity_id)
          WHEN a.entity_type = 'quality_event' THEN (SELECT title FROM carecore_quality_events WHERE id = a.entity_id)
          WHEN a.entity_type = 'quality_action' THEN (SELECT title FROM carecore_quality_actions WHERE id = a.entity_id)
          WHEN a.entity_type = 'care_plan' THEN (SELECT focus FROM carecore_care_plans WHERE id = a.entity_id)
          WHEN a.entity_type = 'wound' THEN (SELECT title FROM carecore_wounds WHERE id = a.entity_id)
          WHEN a.entity_type IN ('standard', 'document') THEN (SELECT title FROM carecore_documents WHERE id = a.entity_id)
          WHEN a.entity_type = 'training' THEN (SELECT title FROM carecore_trainings WHERE id = a.entity_id)
        END AS entity_name
      FROM carecore_audit_log a LEFT JOIN carecore_users u ON u.id = a.actor_user_id
      LEFT JOIN carecore_user_profiles p ON p.user_id = a.actor_user_id
      WHERE (a.organization_id = ${org} OR (a.organization_id IS NULL AND p.organization_id = ${org}))
        AND (${types === null} OR a.entity_type = ANY(${types ?? []}))
      ORDER BY a.created_at DESC LIMIT 40` as Promise<Row[]>,
    ctx.sql`
      SELECT
        (SELECT COUNT(*) FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
          WHERE si.organization_id = ${org} AND cu.active AND cu.lead_user_id IS NULL)::int AS units_without_lead,
        (SELECT COUNT(*) FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
          WHERE si.organization_id = ${org} AND cu.active AND cu.capacity IS NOT NULL AND cu.capacity < (
            SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
            WHERE st.care_unit_id = cu.id AND st.ended_at IS NULL AND r.status = 'active'))::int AS overbooked,
        (SELECT COUNT(*) FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
          WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL AND p.primary_care_unit_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM carecore_user_unit_assignments a WHERE a.user_id = u.id))::int AS staff_without_unit,
        (SELECT COUNT(*) FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
          WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL AND p.last_seen_at IS NULL
            AND u.created_at < NOW() - INTERVAL '7 days')::int AS never_signed_in,
        (SELECT COUNT(*) FROM carecore_residents r WHERE r.organization_id = ${org} AND r.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM carecore_resident_stays st WHERE st.resident_id = r.id AND st.ended_at IS NULL
            AND st.care_unit_id IS NOT NULL))::int AS residents_without_unit,
        (SELECT COUNT(*) FROM carecore_care_supply_products WHERE organization_id = ${org} AND status = 'active'
          AND min_stock_quantity > 0 AND current_stock_quantity <= min_stock_quantity)::int AS supplies_low` as Promise<
      Row[]
    >,
    readSettings(ctx),
    readTerms(ctx),
  ]);

  const counts = todo[0] ?? {};
  const priorities: AdminPriority[] = [];
  const add = (count: unknown, item: Omit<AdminPriority, "id" | "detail"> & { detail: (n: number) => string }) => {
    const n = Number(count ?? 0);
    if (n) priorities.push({ ...item, id: item.title, detail: item.detail(n), href: `/c${item.href}` });
  };
  add(counts.overbooked, {
    title: "Überbelegung prüfen",
    detail: (n) => `${n} Wohnbereich${n === 1 ? "" : "e"} über der Kapazität`,
    tone: "critical",
    href: "/leitung/administration",
  });
  add(counts.residents_without_unit, {
    title: `${t.many} ohne Wohnbereich`,
    detail: (n) => `${n} ${n === 1 ? t.oneOblique : t.many} einem Wohnbereich zuteilen`,
    tone: "critical",
    href: "/bewohner",
  });
  add(counts.supplies_low, {
    title: "Pflegebedarf nachbestellen",
    detail: (n) => `${n} Produkt${n === 1 ? "" : "e"} am Mindestbestand`,
    tone: "attention",
    href: "/leitung/administration/pflegebedarf",
  });
  add(counts.units_without_lead, {
    title: "Bereichsleitung festlegen",
    detail: (n) => `${n} Wohnbereich${n === 1 ? "" : "e"} ohne Leitung`,
    tone: "attention",
    href: "/leitung/administration",
  });
  add(counts.staff_without_unit, {
    title: "Mitarbeitende zuteilen",
    detail: (n) => `${n} Profil${n === 1 ? "" : "e"} ohne Arbeitsbereich`,
    tone: "attention",
    href: "/leitung/administration/mitarbeiter",
  });
  add(counts.never_signed_in, {
    title: "Zugang nie genutzt",
    detail: (n) => `${n} Profil${n === 1 ? "" : "e"} seit über 7 Tagen ohne Anmeldung`,
    tone: "info",
    href: "/leitung/administration/mitarbeiter",
  });
  const off = (["documentationReminder", "vitalsReminder", "medicationOverdue"] as SettingKey[]).filter(
    (key) => !settings[key].enabled,
  );
  if (off.length)
    priorities.push({
      id: "settings",
      title: "Erinnerungen ausgeschaltet",
      detail: off.map((key) => SETTING_DEFINITIONS[key].title).join(", "),
      tone: "attention",
      href: "/c/leitung/administration/konfiguration",
    });

  const log = logRows.map((row) => {
    const entityType = String(row.entity_type);
    const action = String(row.action);
    const href = AUDIT_AREAS[entityType]?.href ?? null;
    return {
      id: String(row.id),
      at: iso(row.created_at) ?? "",
      actor: String(row.actor),
      area: auditArea(entityType, t),
      title: auditTitle(entityType, action, t),
      subject: subject(row),
      changes: auditChanges(entityType, action, row.before_data, row.after_data),
      href: href ? `/c${href}` : null,
    };
  });
  const residentIds = logRows.map(residentOf);
  // Kennungen (Leitung eines Wohnbereichs, betroffene Person, Wohnbereich) erscheinen mit Namen.
  const ids = [
    ...new Set([
      ...log.flatMap((entry) => entry.changes.flatMap((change) => [change.before, change.after])),
      ...residentIds.map((id) => id ?? ""),
    ]),
  ].filter((value) => UUID.test(value));
  if (ids.length) {
    const named = (await ctx.sql`
      SELECT id::text, display_name AS name FROM carecore_users WHERE id = ANY(${ids}::uuid[])
      UNION ALL SELECT id::text, first_name || ' ' || last_name FROM carecore_residents
        WHERE id = ANY(${ids}::uuid[]) AND organization_id = ${org}
      UNION ALL SELECT cu.id::text, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
        WHERE cu.id = ANY(${ids}::uuid[]) AND si.organization_id = ${org}`) as Row[];
    const names = new Map(named.map((item) => [String(item.id), String(item.name)]));
    log.forEach((entry, index) => {
      const residentId = residentIds[index];
      if (!entry.subject && residentId) entry.subject = names.get(residentId) ?? "";
      for (const change of entry.changes) {
        change.before = UUID.test(change.before) ? (names.get(change.before) ?? "nicht mehr vorhanden") : change.before;
        change.after = UUID.test(change.after) ? (names.get(change.after) ?? "nicht mehr vorhanden") : change.after;
      }
    });
  }
  // Rollen erscheinen mit ihrem Namen statt dem Schlüssel.
  const roleKeys = [
    ...new Set(
      log
        .flatMap((entry) => entry.changes.filter((change) => change.field === "Rolle"))
        .flatMap((c) => [c.before, c.after]),
    ),
  ];
  if (roleKeys.length) {
    const roles = (await ctx.sql`SELECT key, name FROM carecore_roles WHERE key = ANY(${roleKeys})`) as Row[];
    const roleNames = new Map(roles.map((role) => [String(role.key), String(role.name)]));
    for (const change of log.flatMap((entry) => entry.changes.filter((item) => item.field === "Rolle"))) {
      change.before = roleNames.get(change.before) ?? change.before;
      change.after = roleNames.get(change.after) ?? change.after;
    }
  }
  return { trend: weeks, priorities, log };
}

// Six calendar weeks up to the current one; three series per page.
async function trendRows(ctx: ApiContext, view: AdminView): Promise<AdminOverview["trend"]> {
  const org = ctx.actor.organizationId;
  const rows = (
    view === "organization"
      ? ctx.sql`
          WITH weeks AS (SELECT generate_series(date_trunc('week', NOW()) - INTERVAL '5 weeks', date_trunc('week', NOW()), INTERVAL '1 week') AS start),
          stays AS (SELECT st.* FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id WHERE r.organization_id = ${org})
          SELECT w.start,
            (SELECT COUNT(*) FROM stays s WHERE s.started_at < LEAST(w.start + INTERVAL '1 week', NOW())
              AND (s.ended_at IS NULL OR s.ended_at >= LEAST(w.start + INTERVAL '1 week', NOW())))::int AS a,
            (SELECT COUNT(*) FROM stays s WHERE s.started_at >= w.start AND s.started_at < w.start + INTERVAL '1 week')::int AS b,
            (SELECT COUNT(*) FROM stays s WHERE s.ended_at >= w.start AND s.ended_at < w.start + INTERVAL '1 week')::int AS c
          FROM weeks w ORDER BY w.start`
      : view === "users"
        ? ctx.sql`
          WITH weeks AS (SELECT generate_series(date_trunc('week', NOW()) - INTERVAL '5 weeks', date_trunc('week', NOW()), INTERVAL '1 week') AS start),
          staff AS (SELECT u.* FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id WHERE p.organization_id = ${org})
          SELECT w.start,
            (SELECT COUNT(*) FROM staff u WHERE u.created_at < w.start + INTERVAL '1 week'
              AND (u.archived_at IS NULL OR u.archived_at >= w.start + INTERVAL '1 week'))::int AS a,
            (SELECT COUNT(*) FROM staff u WHERE u.created_at >= w.start AND u.created_at < w.start + INTERVAL '1 week')::int AS b,
            (SELECT COUNT(*) FROM carecore_audit_log l WHERE l.entity_type IN ('user', 'role')
              AND l.actor_user_id IN (SELECT id FROM staff)
              AND l.created_at >= w.start AND l.created_at < w.start + INTERVAL '1 week')::int AS c
          FROM weeks w ORDER BY w.start`
        : ctx.sql`
          WITH weeks AS (SELECT generate_series(date_trunc('week', NOW()) - INTERVAL '5 weeks', date_trunc('week', NOW()), INTERVAL '1 week') AS start),
          log AS (SELECT * FROM carecore_audit_log WHERE organization_id = ${org})
          SELECT w.start,
            (SELECT COUNT(*) FROM log l WHERE l.created_at >= w.start AND l.created_at < w.start + INTERVAL '1 week')::int AS a,
            (SELECT COUNT(*) FROM log l WHERE l.entity_type IN ('site', 'care_unit', 'user', 'role', 'setting')
              AND l.created_at >= w.start AND l.created_at < w.start + INTERVAL '1 week')::int AS b,
            (SELECT COUNT(*) FROM log l WHERE l.entity_type = 'setting'
              AND l.created_at >= w.start AND l.created_at < w.start + INTERVAL '1 week')::int AS c
          FROM weeks w ORDER BY w.start`
  ) as Promise<Row[]>;
  const data = await rows;
  const meta: Record<AdminView, { title: string; subtitle: string; labels: [string, string, string] }> = {
    organization: {
      title: "Belegung im Zeitraum",
      subtitle: "Belegte Plätze, Eintritte und Austritte pro Woche",
      labels: ["Belegung", "Eintritte", "Austritte"],
    },
    users: {
      title: "Personal im Zeitraum",
      subtitle: "Aktive Profile, neue Profile und Zugriffsänderungen pro Woche",
      labels: ["Aktiv", "Neu", "Änderungen"],
    },
    configuration: {
      title: "Änderungen im Zeitraum",
      subtitle: "Protokollierte Änderungen pro Woche",
      labels: ["Gesamt", "Verwaltung", "Einstellungen"],
    },
  };
  return {
    ...meta[view],
    weeks: data.map((row) => {
      const start = new Date(iso(row.start) ?? "");
      return `KW ${isoWeek(start)}`;
    }),
    series: ["a", "b", "c"].map((key) => data.map((row) => Number(row[key] ?? 0))),
  };
}

function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
