import { assertUuid, iso, type ApiContext, type Row } from "@/lib/api-context";
import { dueAssessments } from "@/lib/assessments";
import { listRound } from "@/lib/medication-round";
import { ROUNDS, initials, type RoundKey } from "@/lib/medication-shared";
import { readSettings } from "@/lib/settings";
import { activeIsolations } from "@/lib/hygiene";
import { isolationLabel, type IsolationKind } from "@/lib/hygiene-shared";
import { activeRestraints } from "@/lib/restraints";
import { restraintLabel, type RestraintKind } from "@/lib/restraints-shared";
import { dueRepositioning } from "@/lib/repositioning";
import { dueStool } from "@/lib/elimination";
import { dueKompass } from "@/lib/kompass";
import { formatInterval } from "@/lib/repositioning-shared";

// "Mein Dienst": what is due today per resident of a care unit, gathered from the
// modules (medication, vital signs, wounds, assessments, care plan, documentation, tasks).

export type WorkItemKind =
  | "medication"
  | "vitals"
  | "wound"
  | "assessment"
  | "plan"
  | "documentation"
  | "task"
  | "restraint"
  | "isolation"
  | "repositioning"
  | "elimination";

export type WorkItem = {
  kind: WorkItemKind;
  label: string;
  detail: string;
  tone: "critical" | "attention" | "info";
  href: string;
};

export type WorkResident = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  items: WorkItem[];
};

export type Worklist = {
  careUnitId: string | null;
  careUnit: string | null;
  residents: WorkResident[];
  totals: Record<WorkItemKind, number>;
};

const TONE_WEIGHT = { critical: 0, attention: 1, info: 2 };

export async function dailyWorklist(ctx: ApiContext, careUnitIdInput: string | null): Promise<Worklist> {
  const careUnitId = careUnitIdInput ? assertUuid(careUnitIdInput, "Wohnbereich") : null;
  const org = ctx.actor.organizationId;
  const [
    residents,
    vitals,
    wounds,
    plans,
    docs,
    tasks,
    rounds,
    assessments,
    settings,
    restraints,
    isolations,
    repositioning,
    stool,
    kompass,
  ] = await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit, cu.id AS care_unit_id
      FROM carecore_residents r
      JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.organization_id = ${org} AND r.status = 'active'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name` as Promise<Row[]>,
    ctx.sql`
      SELECT r.id AS resident_id, MAX(v.measured_at) AS last_at,
        BOOL_OR(v.status = 'critical' AND v.measured_at > NOW() - INTERVAL '24 hours') AS critical
      FROM carecore_residents r LEFT JOIN carecore_vital_measurements v ON v.resident_id = r.id
      WHERE r.organization_id = ${org} AND r.status = 'active' GROUP BY r.id` as Promise<Row[]>,
    ctx.sql`
      SELECT w.resident_id, w.title, w.severity,
        (COALESCE(e.observed_at, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days)) < NOW() + INTERVAL '12 hours' AS due
      FROM carecore_wounds w JOIN carecore_residents r ON r.id = w.resident_id AND r.organization_id = ${org}
      LEFT JOIN LATERAL (SELECT observed_at FROM carecore_wound_entries WHERE wound_id = w.id ORDER BY observed_at DESC LIMIT 1) e ON TRUE
      WHERE w.status IN ('active', 'healing') AND w.care_interval_days IS NOT NULL` as Promise<Row[]>,
    ctx.sql`
      SELECT r.id AS resident_id, p.id AS plan_id,
        (p.status = 'review' OR p.review_on <= (NOW() AT TIME ZONE o.timezone)::date OR EXISTS (
          SELECT 1 FROM carecore_care_goals g WHERE g.care_plan_id = p.id AND g.status = 'active'
            AND g.target_date <= (NOW() AT TIME ZONE o.timezone)::date)) AS review_due
      FROM carecore_residents r JOIN carecore_organizations o ON o.id = r.organization_id
      LEFT JOIN carecore_care_plans p ON p.resident_id = r.id AND p.status IN ('draft', 'active', 'review')
      WHERE r.organization_id = ${org} AND r.status = 'active'` as Promise<Row[]>,
    ctx.sql`
      SELECT r.id AS resident_id, MAX(d.occurred_at) AS last_at
      FROM carecore_residents r LEFT JOIN carecore_documentation_entries d ON d.resident_id = r.id
      WHERE r.organization_id = ${org} AND r.status = 'active' GROUP BY r.id` as Promise<Row[]>,
    ctx.sql`
      SELECT t.resident_id, t.title, t.priority, (t.due_at < NOW()) AS overdue,
        to_char(t.due_at AT TIME ZONE o.timezone, 'HH24:MI') AS time
      FROM carecore_tasks t JOIN carecore_organizations o ON o.id = t.organization_id
      WHERE t.organization_id = ${org} AND t.resident_id IS NOT NULL AND t.status IN ('open', 'in_progress', 'escalated')
        AND t.due_at < ((NOW() AT TIME ZONE o.timezone)::date + 1) AT TIME ZONE o.timezone
      ORDER BY t.due_at` as Promise<Row[]>,
    Promise.all((Object.keys(ROUNDS) as RoundKey[]).map((round) => listRound(ctx, round, null))),
    dueAssessments(ctx),
    readSettings(ctx),
    activeRestraints(ctx),
    activeIsolations(ctx),
    dueRepositioning(ctx),
    dueStool(ctx),
    dueKompass(ctx),
  ]);
  // Reminder thresholds of "Leitung · Konfiguration".
  const overdueMs = settings.medicationOverdue.enabled ? (settings.medicationOverdue.value ?? 30) * 60_000 : Infinity;
  const vitalsMs = (settings.vitalsReminder.value ?? 7) * 86_400_000;
  const docMs = (settings.documentationReminder.value ?? 24) * 3_600_000;
  const now = Date.now();
  const doses = rounds.flatMap((round) => round.doses).filter((dose) => dose.status === "scheduled");
  const by = <T extends { resident_id?: unknown }>(rows: T[], id: string) =>
    rows.filter((row) => row.resident_id === id);

  const list: WorkResident[] = residents.map((row) => {
    const id = String(row.id);
    const name = `${row.first_name} ${row.last_name}`;
    const items: WorkItem[] = [];

    const own = doses.filter((dose) => dose.residentId === id);
    const overdue = own.filter((dose) => Date.parse(dose.scheduledAt) < now - overdueMs);
    const soon = own.filter(
      (dose) => Date.parse(dose.scheduledAt) >= now - overdueMs && Date.parse(dose.scheduledAt) <= now + 2 * 3_600_000,
    );
    if (overdue.length)
      items.push({
        kind: "medication",
        label: `${overdue.length} Gabe${overdue.length === 1 ? "" : "n"} überfällig`,
        detail: `seit ${overdue[0].time} · ${overdue.map((dose) => dose.medication).join(", ")}`,
        tone: "critical",
        href: "/c/medikation/runde",
      });
    else if (soon.length)
      items.push({
        kind: "medication",
        label: `${soon.length} Gabe${soon.length === 1 ? "" : "n"} um ${soon[0].time}`,
        detail: soon.map((dose) => dose.medication).join(", "),
        tone: "attention",
        href: "/c/medikation/runde",
      });

    const vital = vitals.find((item) => item.resident_id === id);
    const lastVital = vital?.last_at ? Date.parse(iso(vital.last_at) ?? "") : null;
    if (vital?.critical)
      items.push({
        kind: "vitals",
        label: "Kritischer Vitalwert",
        detail: "Kontrollmessung empfohlen",
        tone: "critical",
        href: "/c/vitalwerte/entwicklung",
      });
    else if (settings.vitalsReminder.enabled && (!lastVital || now - lastVital > vitalsMs))
      items.push({
        kind: "vitals",
        label: "Vitalwerte messen",
        detail: lastVital
          ? `letzte Messung vor über ${settings.vitalsReminder.value} Tag${settings.vitalsReminder.value === 1 ? "" : "en"}`
          : "noch nie gemessen",
        tone: "info",
        href: "/c/vitalwerte/entwicklung",
      });

    for (const wound of by(wounds, id).filter((item) => item.due))
      items.push({
        kind: "wound",
        label: "Verbandswechsel",
        detail: String(wound.title),
        tone: wound.severity === "critical" ? "critical" : "attention",
        href: `/c/wundmanagement?resident=${id}`,
      });

    const dueAssess = assessments.filter((item) => item.residentId === id && item.kind !== "due");
    if (dueAssess.length)
      items.push({
        kind: "assessment",
        label: `${dueAssess.length} Einschätzung${dueAssess.length === 1 ? "" : "en"} fällig`,
        detail: dueAssess.map((item) => item.name).join(", "),
        tone: dueAssess.some((item) => item.kind === "overdue") ? "attention" : "info",
        href: "/c/einschaetzungen/faelligkeiten",
      });

    // Abklärung mit dem Kompass: begonnen, fällig oder überfällig (nach den Fristen der Einrichtung).
    const abklaerung = kompass.find((row) => row.id === id);
    if (abklaerung)
      items.push({
        kind: "assessment",
        label: abklaerung.state === "in_progress" ? "Kompass fortsetzen" : "Kompass fällig",
        detail:
          abklaerung.state === "in_progress"
            ? `Abklärung zu ${abklaerung.progress}% erledigt`
            : `${abklaerung.state === "overdue" ? "seit" : "am"} ${abklaerung.dueOn?.split("-").reverse().join(".") ?? ""}`,
        tone: abklaerung.state === "overdue" ? "attention" : "info",
        href: `/c/kompass/abklaerung?resident=${id}`,
      });

    const plan = plans.find((item) => item.resident_id === id);
    if (plan && !plan.plan_id)
      items.push({
        kind: "plan",
        label: "Kein Pflegeplan",
        detail: "Pflegeplan anlegen",
        tone: "info",
        href: `/c/pflegeplanung?resident=${id}`,
      });
    else if (plan?.review_due)
      items.push({
        kind: "plan",
        label: "Evaluation fällig",
        detail: "Pflegeziele überprüfen",
        tone: "attention",
        href: `/c/pflegeplanung?resident=${id}`,
      });

    const doc = docs.find((item) => item.resident_id === id);
    const lastDoc = doc?.last_at ? Date.parse(iso(doc.last_at) ?? "") : null;
    if (settings.documentationReminder.enabled && (!lastDoc || now - lastDoc > docMs))
      items.push({
        kind: "documentation",
        label: "Dokumentation fehlt",
        detail: lastDoc ? `kein Eintrag seit ${settings.documentationReminder.value} Stunden` : "noch nie dokumentiert",
        tone: "attention",
        href: "/c/pflegedokumentation",
      });

    for (const task of by(tasks, id))
      items.push({
        kind: "task",
        label: String(task.title),
        detail: task.overdue ? `überfällig seit ${task.time}` : `fällig ${task.time}`,
        tone:
          task.overdue || task.priority === "critical" ? "critical" : task.priority === "high" ? "attention" : "info",
        href: "/c/betrieb/aufgaben",
      });

    // Freiheitsbeschränkende Massnahmen: Überprüfung fällig, Vertretung noch nicht informiert.
    for (const measure of by(restraints, id)) {
      const label = restraintLabel({ kind: measure.kind as RestraintKind, description: String(measure.description) });
      const href = `/c/bewohner?resident=${id}&ansicht=fbm`;
      if (measure.review_due)
        items.push({ kind: "restraint", label: "FBM überprüfen", detail: label, tone: "attention", href });
      if (measure.representative_pending)
        items.push({
          kind: "restraint",
          label: "Vertretung über FBM informieren",
          detail: label,
          tone: "attention",
          href,
        });
    }

    // Isolation: Überprüfung fällig, sonst als Hinweis für den Dienst.
    for (const isolation of by(isolations, id)) {
      const label = isolationLabel(isolation.kind as IsolationKind);
      items.push(
        isolation.review_due
          ? {
              kind: "isolation",
              label: "Isolation überprüfen",
              detail: label,
              tone: "attention",
              href: "/c/bewohner/hygiene",
            }
          : {
              kind: "isolation",
              label: "Isolation beachten",
              detail: [label, isolation.precautions].filter(Boolean).join(" · "),
              tone: "info",
              href: "/c/bewohner/hygiene",
            },
      );
    }

    // Lagerung laut Plan: fällig (letzter Wechsel plus Intervall) oder in der nächsten Stunde.
    for (const plan of by(repositioning, id)) {
      const due = Date.parse(iso(plan.due_at) ?? "");
      const time = String(plan.time);
      const every = `alle ${formatInterval(Number(plan.interval_minutes))}`;
      if (due <= now)
        items.push({
          kind: "repositioning",
          label: "Lagerung fällig",
          detail: `seit ${time} · ${every}`,
          tone: "attention",
          href: "/c/pflegedokumentation/lagerung",
        });
      else if (due - now <= 3_600_000)
        items.push({
          kind: "repositioning",
          label: "Lagerung",
          detail: `um ${time} · ${every}`,
          tone: "info",
          href: "/c/pflegedokumentation/lagerung",
        });
    }

    // Ausscheidung: kein Stuhlgang seit der Tageszahl der Einrichtung (nur mit geführtem Protokoll).
    for (const entry of by(stool, id)) {
      const since = Number(entry.since);
      items.push({
        kind: "elimination",
        label: "Stuhlgang beobachten",
        detail: entry.never
          ? `kein Stuhlgang dokumentiert seit Beginn des Protokolls (${since} ${since === 1 ? "Tag" : "Tage"})`
          : `letzter Stuhlgang vor ${since} ${since === 1 ? "Tag" : "Tagen"}`,
        tone: "attention",
        href: "/c/pflegedokumentation/ausscheidung",
      });
    }

    items.sort((a, b) => TONE_WEIGHT[a.tone] - TONE_WEIGHT[b.tone]);
    return { id, name, initials: initials(name), room: String(row.room), careUnit: String(row.care_unit), items };
  });

  const totals = {
    medication: 0,
    vitals: 0,
    wound: 0,
    assessment: 0,
    plan: 0,
    documentation: 0,
    task: 0,
    restraint: 0,
    isolation: 0,
    repositioning: 0,
    elimination: 0,
  };
  for (const resident of list) for (const item of resident.items) totals[item.kind] += 1;
  const urgency = (resident: WorkResident) =>
    resident.items.length ? Math.min(...resident.items.map((item) => TONE_WEIGHT[item.tone])) : 9;
  return {
    careUnitId,
    careUnit: careUnitId ? ((residents[0]?.care_unit as string | undefined) ?? null) : null,
    residents: list.sort((a, b) => urgency(a) - urgency(b) || b.items.length - a.items.length),
    totals,
  };
}
