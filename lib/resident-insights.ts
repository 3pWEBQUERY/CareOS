import { iso, type ApiContext, type Row } from "@/lib/api-context";
import { today } from "@/lib/care-planning";
import { readTerms } from "@/lib/settings";
import type { InsightTone, ResidentInsights, ResidentOverview } from "@/lib/insights-shared";
import { nutritionTrends } from "@/lib/nutrition-trends";
import { dailyWorklist } from "@/lib/worklist";

// Zeitraum der Ereignisübersicht je Bewohner (Anzeige, kein Grenzwert).
export const RESIDENT_EVENT_DAYS = 90;

const TONE_ORDER: Record<InsightTone, number> = { critical: 0, attention: 1, info: 2, stable: 3 };

// Resident 360: je aktivem Bewohner der Stand aus allen Modulen, die dringendsten zuerst.
export async function residentInsights(ctx: ApiContext): Promise<ResidentInsights> {
  const org = ctx.actor.organizationId;
  const [worklist, wounds, events, docs, date, t] = await Promise.all([
    dailyWorklist(ctx, null),
    ctx.sql`
      SELECT w.resident_id, COUNT(*)::int AS active, COUNT(*) FILTER (WHERE w.severity = 'critical')::int AS critical
      FROM carecore_wounds w JOIN carecore_residents r ON r.id = w.resident_id
      WHERE r.organization_id = ${org} AND r.status = 'active' AND w.status IN ('active', 'healing')
      GROUP BY w.resident_id` as Promise<Row[]>,
    ctx.sql`
      SELECT e.resident_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE e.type = 'Sturz')::int AS falls,
        COUNT(*) FILTER (WHERE e.status IN ('open', 'investigating'))::int AS open
      FROM carecore_quality_events e
      WHERE e.organization_id = ${org} AND e.resident_id IS NOT NULL
        AND e.occurred_at > NOW() - make_interval(days => ${RESIDENT_EVENT_DAYS})
      GROUP BY e.resident_id` as Promise<Row[]>,
    ctx.sql`
      SELECT d.resident_id, MAX(d.occurred_at) AS last_at
      FROM carecore_documentation_entries d JOIN carecore_residents r ON r.id = d.resident_id
      WHERE r.organization_id = ${org} AND r.status = 'active'
      GROUP BY d.resident_id` as Promise<Row[]>,
    today(ctx),
    readTerms(ctx),
  ]);
  const ids = worklist.residents.map((resident) => resident.id);
  const trends = await nutritionTrends(ctx, ids, date);
  const byResident = (rows: Row[]) => new Map(rows.map((row) => [String(row.resident_id), row]));
  const woundRows = byResident(wounds);
  const eventRows = byResident(events);
  const docRows = byResident(docs);

  const residents: ResidentOverview[] = worklist.residents.map((resident) => {
    const count = (tone: "critical" | "attention" | "info") =>
      resident.items.filter((item) => item.tone === tone).length;
    const today = {
      critical: count("critical"),
      attention: count("attention"),
      info: count("info"),
      labels: resident.items.slice(0, 3).map((item) => item.label),
    };
    const wound = woundRows.get(resident.id);
    const event = eventRows.get(resident.id);
    const overview = {
      wounds: { active: Number(wound?.active ?? 0), critical: Number(wound?.critical ?? 0) },
      events: { total: Number(event?.total ?? 0), falls: Number(event?.falls ?? 0), open: Number(event?.open ?? 0) },
      trends: (trends.get(resident.id) ?? []).map((trend) => trend.text),
    };
    const tone: InsightTone =
      today.critical || overview.wounds.critical
        ? "critical"
        : today.attention || overview.events.open || overview.trends.length
          ? "attention"
          : today.info || overview.wounds.active
            ? "info"
            : "stable";
    return {
      id: resident.id,
      name: resident.name,
      initials: resident.initials,
      room: resident.room,
      careUnit: resident.careUnit,
      tone,
      today,
      ...overview,
      lastDocumentation: iso(docRows.get(resident.id)?.last_at ?? null),
    };
  });
  residents.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.name.localeCompare(b.name, "de-CH"));

  const critical = residents.filter((resident) => resident.tone === "critical").length;
  const woundsActive = residents.reduce((sum, resident) => sum + resident.wounds.active, 0);
  const eventsTotal = residents.reduce((sum, resident) => sum + resident.events.total, 0);
  const falls = residents.reduce((sum, resident) => sum + resident.events.falls, 0);
  const withTrends = residents.filter((resident) => resident.trends.length).length;
  return {
    eventDays: RESIDENT_EVENT_DAYS,
    residents,
    kpis: [
      {
        value: String(critical),
        id: "Bewohner kritisch",
        label: `${t.many} kritisch`,
        note: `von ${residents.length} aktiven ${t.manyDative}`,
        tone: critical ? "critical" : "stable",
      },
      {
        value: String(woundsActive),
        label: "aktive Wunden",
        note: `bei ${residents.filter((resident) => resident.wounds.active).length} ${t.manyDative}`,
        tone: woundsActive ? "info" : "stable",
      },
      {
        value: String(eventsTotal),
        label: "Ereignisse",
        note: `letzte ${RESIDENT_EVENT_DAYS} Tage · davon ${falls} ${falls === 1 ? "Sturz" : "Stürze"}`,
        tone: eventsTotal ? "attention" : "stable",
      },
      {
        value: String(withTrends),
        label: "Ernährungshinweise",
        note: "nach den Grenzen der Einrichtung",
        tone: withTrends ? "attention" : "stable",
      },
    ],
  };
}
