import { readTerms } from "@/lib/settings";
import { ApiError, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { MistralError, mistralConfigured, mistralJson } from "@/lib/mistral";

// Such-Assistenz von CareOS KI: eine Frage in Alltagssprache („Wer ist diese Woche gestürzt?“) über die
// Bewohnenden eines Wohnbereichs oder der ganzen Einrichtung. Die KI bekommt die Daten pseudonymisiert (Kennung R1,
// R2 …, Kürzel, Zimmer) und antwortet nur daraus; CareOS ordnet die genannten Kennungen wieder den Akten zu.
// Nichts wird gespeichert ausser einem Protokolleintrag ohne Fragetext.

export type AiSearchResult = {
  answer: string;
  residents: Array<{ id: string; name: string; room: string }>;
};

type JsonCall = typeof mistralJson;
let searchCall: JsonCall = mistralJson;
// Tests setzen ein Test-Double.
export const setSearchCall = (call: JsonCall) => {
  searchCall = call;
};

const SYSTEM = `Du bist die Such-Assistenz von CareOS, einer Pflegedokumentation für Alters- und Pflegeheime.
Beantworte die Frage einer Pflegefachperson ausschliesslich aus den mitgelieferten Daten. Erfinde nichts; steht die
Antwort nicht in den Daten, sage das klar. Schreibe auf Deutsch, knapp (höchstens etwa 8 Sätze oder Aufzählungspunkte).
Bewohnende sind pseudonymisiert: nenne sie mit ihrer Kennung in eckigen Klammern, z. B. [R3], und führe alle Kennungen,
auf die sich die Antwort stützt, im Feld "residents" auf. Keine Diagnosen, keine Medikationsanordnungen.`;

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    residents: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "residents"],
};

const when = (value: unknown) =>
  new Date(iso(value) ?? "").toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const initials = (row: Row) => `${String(row.first_name)[0] ?? ""}${String(row.last_name)[0] ?? ""}`.toUpperCase();

export async function aiSearch(ctx: ApiContext, body: Record<string, unknown>): Promise<AiSearchResult> {
  if (!mistralConfigured())
    throw new ApiError("CareOS KI ist noch nicht eingerichtet: MISTRAL_API_KEY fehlt in der Umgebung.", 503);
  const question = text(body.question, 400);
  if (question.length < 5) throw new ApiError("Bitte eine Frage eingeben.");
  const careUnitId =
    typeof body.careUnitId === "string" && /^[0-9a-f-]{36}$/i.test(body.careUnitId) ? body.careUnitId : null;
  const t = await readTerms(ctx);

  const residents = (await ctx.sql`
    SELECT r.id, r.first_name, r.last_name, r.risk_flags, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit
    FROM carecore_residents r
    JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
    ORDER BY cu.name, ro.name NULLS LAST, r.last_name
    LIMIT 150`) as Row[];
  if (!residents.length) return { answer: `Im gewählten Bereich sind keine ${t.many} erfasst.`, residents: [] };
  const ids = residents.map((row) => String(row.id));
  const token = new Map(ids.map((id, index) => [id, `R${index + 1}`]));

  const [docs, events, vitals, wounds, tasks] = (await Promise.all([
    ctx.sql`
      SELECT resident_id, category, body, occurred_at, importance FROM carecore_documentation_entries
      WHERE resident_id = ANY(${ids}) AND occurred_at > NOW() - INTERVAL '7 days'
      ORDER BY occurred_at DESC LIMIT 300`,
    ctx.sql`
      SELECT resident_id, type, severity, status, occurred_at, description FROM carecore_quality_events
      WHERE organization_id = ${ctx.actor.organizationId} AND resident_id = ANY(${ids})
        AND occurred_at > NOW() - INTERVAL '30 days'
      ORDER BY occurred_at DESC LIMIT 100`,
    ctx.sql`
      SELECT resident_id, metric, value, secondary_value, unit, status, measured_at FROM carecore_vital_measurements
      WHERE resident_id = ANY(${ids}) AND measured_at > NOW() - INTERVAL '7 days' AND status <> 'normal'
      ORDER BY measured_at DESC LIMIT 150`,
    ctx.sql`
      SELECT resident_id, title, body_location, severity, status FROM carecore_wounds
      WHERE resident_id = ANY(${ids}) AND status IN ('active', 'healing')`,
    ctx.sql`
      SELECT resident_id, title, priority, due_at, status FROM carecore_tasks
      WHERE resident_id = ANY(${ids}) AND status IN ('open', 'in_progress', 'escalated')
      ORDER BY due_at NULLS LAST LIMIT 120`,
  ])) as Row[][];

  const tag = (row: Row) => `[${token.get(String(row.resident_id)) ?? "?"}]`;
  const data = [
    `${t.many} (Kennung, Kürzel, Zimmer, Wohnbereich, Hinweise):`,
    ...residents.map((row) => {
      const flags = Array.isArray(row.risk_flags)
        ? (row.risk_flags as Array<{ label?: string }>).map((flag) => flag.label).filter(Boolean)
        : [];
      return `[${token.get(String(row.id))}] ${initials(row)}, ${row.room || "ohne Zimmer"}, ${row.unit}${
        flags.length ? `, ${flags.join(", ")}` : ""
      }`;
    }),
    "",
    "Ereignisse (30 Tage):",
    ...events.map(
      (row) =>
        `${tag(row)} ${when(row.occurred_at)} ${row.type} (${row.severity}, ${row.status}): ${String(row.description).slice(0, 300)}`,
    ),
    "",
    "Berichte (7 Tage):",
    ...docs.map(
      (row) =>
        `${tag(row)} ${when(row.occurred_at)} [${row.category}${row.importance !== "standard" ? `, ${row.importance}` : ""}]: ${String(row.body).slice(0, 300)}`,
    ),
    "",
    "Auffällige Vitalwerte (7 Tage):",
    ...vitals.map(
      (row) =>
        `${tag(row)} ${when(row.measured_at)} ${row.metric} ${Number(row.value)}${
          row.secondary_value !== null ? `/${Number(row.secondary_value)}` : ""
        } ${row.unit} (${row.status})`,
    ),
    "",
    "Offene Wunden:",
    ...wounds.map((row) => `${tag(row)} ${row.title}, ${row.body_location} (${row.status}, ${row.severity})`),
    "",
    "Offene Aufgaben:",
    ...tasks.map(
      (row) => `${tag(row)} ${row.title} (${row.priority}${row.due_at ? `, fällig ${when(row.due_at)}` : ""})`,
    ),
  ].join("\n");

  let parsed: { answer?: unknown; residents?: unknown };
  try {
    parsed = JSON.parse(
      await searchCall({
        system: SYSTEM.replaceAll("Bewohnende", t.many),
        user: `Frage: ${question}\n\nStand: ${when(new Date())}\n\n${data}`,
        schema: SCHEMA,
      }),
    ) as { answer?: unknown; residents?: unknown };
  } catch (error) {
    if (error instanceof MistralError)
      throw new ApiError(error.status === 503 ? `CareOS KI: ${error.message}` : error.message, error.status);
    if (error instanceof SyntaxError) throw new ApiError("Die KI hat keine verwertbare Antwort geliefert.", 502);
    throw error;
  }
  const byToken = new Map(residents.map((row) => [token.get(String(row.id))!, row]));
  const named = (Array.isArray(parsed.residents) ? parsed.residents : [])
    .map((value) => byToken.get(String(value).replace(/[[\]\s]/g, "")))
    .filter((row): row is Row => Boolean(row));
  const unique = [...new Map(named.map((row) => [String(row.id), row])).values()];
  // Kennungen im Text durch Kürzel ersetzen (die Namen zeigt die Oberfläche als Links).
  const answer = String(parsed.answer ?? "").replace(/\[(R\d+)\]/g, (match, id: string) => {
    const row = byToken.get(id);
    return row ? `${row.first_name} ${row.last_name}` : match;
  });
  await ctx.sql.transaction([
    auditStatement(ctx, "ai_search", ctx.actor.id, "asked", null, {
      careUnitId,
      residents: residents.length,
      questionLength: question.length,
    }),
  ]);
  return {
    answer: answer.trim() || "Die KI hat keine Antwort geliefert.",
    residents: unique.map((row) => ({
      id: String(row.id),
      name: `${row.first_name} ${row.last_name}`,
      room: String(row.room || ""),
    })),
  };
}
