import { ApiError, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { rosterContextFrom } from "@/lib/roster/context";
import { clockIn, clockOut } from "@/lib/roster/time-service";
import {
  CHECKLIST,
  HANDOVER_STATUS,
  SHIFT_TYPES,
  type ChecklistKey,
  type HandoverStatus,
  type ShiftType,
} from "@/lib/shift-shared";
import { DATE } from "./shift";

// „Dienst starten/beenden“ in Mein Dienst stempelt in der Zeiterfassung des Dienstplans ein und aus
// (ein System für Ist-Zeiten, DECISIONS D1).

export function parseCheckIn(body: Record<string, unknown>) {
  const checklist = Array.isArray(body.checklist)
    ? [...new Set(body.checklist.filter((key): key is ChecklistKey => typeof key === "string" && key in CHECKLIST))]
    : [];
  const handoverStatus =
    typeof body.handoverStatus === "string" && body.handoverStatus in HANDOVER_STATUS
      ? (body.handoverStatus as HandoverStatus)
      : "pending";
  return { checklist, handoverStatus, note: text(body.note, 2000) || null };
}

export async function checkIn(ctx: ApiContext, body: Record<string, unknown>) {
  const input = parseCheckIn(body);
  const roster = await rosterContextFrom(ctx);
  if (body.assignmentId) {
    const { id } = await clockIn(roster, { ...input, shiftId: body.assignmentId });
    return id;
  }
  // Ohne geplanten Dienst: der gewählte Dienst muss jetzt laufen oder in den nächsten 2 Stunden beginnen.
  const shiftType =
    typeof body.shiftType === "string" && body.shiftType in SHIFT_TYPES ? (body.shiftType as ShiftType) : null;
  if (!shiftType) throw new ApiError("Bitte den Dienst wählen.");
  if (typeof body.date !== "string" || !DATE.test(body.date)) throw new ApiError("Bitte das Startdatum wählen.");
  const { start, end } = SHIFT_TYPES[shiftType];
  const times = (await ctx.sql`
    SELECT ((${body.date}::date + ${start}::time) AT TIME ZONE timezone) AS starts_at,
      ((${body.date}::date + ${end <= start ? 1 : 0}::int + ${end}::time) AT TIME ZONE timezone) AS ends_at
    FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`) as Row[];
  const startsAt = iso(times[0]?.starts_at) ?? "";
  const endsAt = iso(times[0]?.ends_at) ?? "";
  if (Date.parse(startsAt) > Date.now() + 2 * 3_600_000 || Date.parse(endsAt) <= Date.now())
    throw new ApiError("Dieser Dienst liegt nicht im aktuellen Zeitraum. Bitte Dienst und Startdatum prüfen.");
  const { id } = await clockIn(roster, { ...input, careUnitId: body.careUnitId || null });
  return id;
}

export async function checkOut(ctx: ApiContext, body: Record<string, unknown>) {
  await clockOut(await rosterContextFrom(ctx), { note: text(body.note, 2000) || null });
}
