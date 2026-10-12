import { randomUUID } from "node:crypto";
import { ApiError, assertResident, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { bandFor, scoreAnswers, type Instrument } from "@/lib/assessment-instruments";
import { allInstruments } from "@/lib/assessment-custom";
import { initials } from "@/lib/medication-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type AssessmentResult = {
  id: string;
  residentId: string;
  code: string;
  name: string;
  score: number | null;
  riskLevel: string | null;
  riskLabel: string | null;
  tone: "stable" | "attention" | "critical" | "info";
  completedAt: string | null;
  nextDueOn: string | null;
  assessor: string | null;
  summary: string | null;
  answers: Record<string, unknown>;
};

export type DueItem = {
  residentId: string;
  residentName: string;
  room: string;
  code: string;
  name: string;
  kind: "missing" | "overdue" | "due" | "open";
  dueOn: string | null;
  lastCompletedAt: string | null;
};

function mapResult(row: Row, instruments: Instrument[]): AssessmentResult {
  const instrument = instruments.find((item) => item.code === String(row.code));
  const score = num(row.score);
  const band = instrument && score !== null ? bandFor(instrument, score) : null;
  return {
    id: String(row.id),
    residentId: String(row.resident_id),
    code: String(row.code),
    name: String(row.name),
    score,
    riskLevel: (row.risk_level as string | null) ?? band?.level ?? null,
    riskLabel: band?.label ?? null,
    tone: band?.tone ?? "info",
    completedAt: iso(row.completed_at),
    nextDueOn: (row.next_due as string | null) ?? null,
    assessor: (row.assessor as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    answers: (row.answers as Record<string, unknown>) ?? {},
  };
}

async function today(ctx: ApiContext) {
  const rows =
    await ctx.sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return String(rows[0].d);
}

// Catalog instruments get a row in carecore_assessments per organization when first used.
async function instrumentId(ctx: ApiContext, instrument: Instrument) {
  const rows = (await ctx.sql`
    INSERT INTO carecore_assessments (id, organization_id, code, name, version, category, definition)
    VALUES (${randomUUID()}, ${ctx.actor.organizationId}, ${instrument.code}, ${instrument.name}, ${instrument.version}, ${instrument.category},
      ${JSON.stringify({ items: instrument.items, bands: instrument.bands })}::jsonb)
    ON CONFLICT (organization_id, code, version) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`) as Row[];
  return String(rows[0].id);
}

async function residentsOf(ctx: ApiContext) {
  return (await ctx.sql`
    SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit
    FROM carecore_residents r
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
    ORDER BY r.last_name, r.first_name`) as Row[];
}

// Latest completed result per resident and instrument (including legacy instruments).
async function latestResults(ctx: ApiContext, instruments: Instrument[]) {
  const rows = (await ctx.sql`
    SELECT DISTINCT ON (rec.resident_id, a.code) rec.id, rec.resident_id, a.code, a.name, rec.score, rec.risk_level, rec.completed_at,
      to_char(rec.next_due_on, 'YYYY-MM-DD') AS next_due, rec.summary, rec.answers, u.display_name AS assessor
    FROM carecore_assessment_records rec
    JOIN carecore_assessments a ON a.id = rec.assessment_id AND a.organization_id = ${ctx.actor.organizationId}
    JOIN carecore_residents r ON r.id = rec.resident_id AND r.status = 'active'
    LEFT JOIN carecore_users u ON u.id = rec.assessor_user_id
    WHERE rec.status = 'completed'
    ORDER BY rec.resident_id, a.code, rec.completed_at DESC`) as Row[];
  return rows.map((row) => mapResult(row, instruments));
}

export async function assessmentsOverview(ctx: ApiContext) {
  const instruments = await allInstruments(ctx);
  const [residents, latest] = await Promise.all([residentsOf(ctx), latestResults(ctx, instruments)]);
  return {
    instruments,
    residents: residents.map((row) => {
      const name = `${row.first_name} ${row.last_name}`;
      return {
        id: String(row.id),
        name,
        initials: initials(name),
        room: String(row.room),
        careUnit: String(row.care_unit),
      };
    }),
    latest,
  };
}

// Missing core instruments, overdue and upcoming (7 days) reassessments, and open drafts.
export async function dueAssessments(ctx: ApiContext): Promise<DueItem[]> {
  const instruments = await allInstruments(ctx);
  const [residents, latest, open, day] = await Promise.all([
    residentsOf(ctx),
    latestResults(ctx, instruments),
    ctx.sql`
      SELECT rec.resident_id, a.code, a.name, to_char(rec.due_on, 'YYYY-MM-DD') AS due_on
      FROM carecore_assessment_records rec
      JOIN carecore_assessments a ON a.id = rec.assessment_id AND a.organization_id = ${ctx.actor.organizationId}
      WHERE rec.status IN ('draft', 'in_progress')` as Promise<Row[]>,
    today(ctx),
  ]);
  const soon = new Date(`${day}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  const soonDay = soon.toISOString().slice(0, 10);
  const items: DueItem[] = [];
  for (const row of residents) {
    const base = {
      residentId: String(row.id),
      residentName: `${row.first_name} ${row.last_name}`,
      room: String(row.room),
    };
    for (const instrument of instruments) {
      const last = latest.find((r) => r.residentId === base.residentId && r.code === instrument.code);
      if (!last) {
        if (instrument.core)
          items.push({
            ...base,
            code: instrument.code,
            name: instrument.name,
            kind: "missing",
            dueOn: null,
            lastCompletedAt: null,
          });
      } else if (last.nextDueOn && last.nextDueOn <= soonDay) {
        items.push({
          ...base,
          code: instrument.code,
          name: instrument.name,
          kind: last.nextDueOn < day ? "overdue" : "due",
          dueOn: last.nextDueOn,
          lastCompletedAt: last.completedAt,
        });
      }
    }
    for (const draft of open.filter((o) => o.resident_id === row.id))
      items.push({
        ...base,
        code: String(draft.code),
        name: String(draft.name),
        kind: "open",
        dueOn: (draft.due_on as string | null) ?? null,
        lastCompletedAt: null,
      });
  }
  const order = { overdue: 0, open: 1, due: 2, missing: 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

export async function residentHistory(ctx: ApiContext, residentIdInput: unknown, codeInput: unknown) {
  const residentId = await assertResident(ctx, residentIdInput);
  const instruments = await allInstruments(ctx);
  const rows = (await ctx.sql`
    SELECT rec.id, rec.resident_id, a.code, a.name, rec.score, rec.risk_level, rec.completed_at, to_char(rec.next_due_on, 'YYYY-MM-DD') AS next_due,
      rec.summary, rec.answers, u.display_name AS assessor
    FROM carecore_assessment_records rec
    JOIN carecore_assessments a ON a.id = rec.assessment_id AND a.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_users u ON u.id = rec.assessor_user_id
    WHERE rec.resident_id = ${residentId} AND rec.status = 'completed' AND (${typeof codeInput === "string" ? codeInput : null}::text IS NULL OR a.code = ${typeof codeInput === "string" ? codeInput : null})
    ORDER BY rec.completed_at DESC LIMIT 50`) as Row[];
  return rows.map((row) => mapResult(row, instruments));
}

export async function recordAssessment(ctx: ApiContext, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, body.residentId);
  const instrument =
    typeof body.instrument === "string"
      ? (await allInstruments(ctx)).find((item) => item.code === body.instrument)
      : undefined;
  if (!instrument) throw new ApiError("Unbekanntes Instrument.");
  const answers = (body.answers ?? {}) as Record<string, unknown>;
  const score = scoreAnswers(instrument, answers);
  if (score === null) throw new ApiError("Bitte alle Fragen des Instruments beantworten.");
  const band = bandFor(instrument, score);
  const day = await today(ctx);
  let nextDueOn = typeof body.nextDueOn === "string" && DATE.test(body.nextDueOn) ? body.nextDueOn : null;
  if (!nextDueOn) {
    const next = new Date(`${day}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + instrument.reassessDays);
    nextDueOn = next.toISOString().slice(0, 10);
  }
  if (nextDueOn <= day) throw new ApiError("Die nächste Einschätzung muss in der Zukunft liegen.");
  const note = text(body.note, 4000);
  const id = randomUUID();
  const assessmentId = await instrumentId(ctx, instrument);
  const cleanAnswers = Object.fromEntries(instrument.items.map((item) => [item.key, answers[item.key]]));
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_assessment_records (id, assessment_id, resident_id, assessor_user_id, status, completed_at, score, answers, summary, risk_level, next_due_on)
      VALUES (${id}, ${assessmentId}, ${residentId}, ${ctx.actor.id}, 'completed', NOW(), ${score}, ${JSON.stringify(cleanAnswers)}::jsonb,
        ${note || band?.label || null}, ${band?.level ?? null}, ${nextDueOn})`,
    // An open draft of the same instrument is done with this result.
    ctx.sql`
      UPDATE carecore_assessment_records SET status = 'superseded', updated_at = NOW()
      WHERE resident_id = ${residentId} AND assessment_id = ${assessmentId} AND status IN ('draft', 'in_progress')`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "assessment_record",
      entityId: id,
      action: "completed",
      after: { instrument: instrument.code, score, risk: band?.level ?? null, nextDueOn },
    }),
  ]);
  return { id, score, riskLabel: band?.label ?? null, tone: band?.tone ?? "info", nextDueOn };
}
