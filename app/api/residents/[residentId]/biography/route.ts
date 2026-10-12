import { NextResponse } from "next/server";
import { changedFields, residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

type BiographyInput = {
  lifeStory?: unknown;
  importantPeople?: unknown;
  dailyRoutines?: unknown;
  preferences?: unknown;
  strengths?: unknown;
  sensitiveTopics?: unknown;
};

const emptyBiography = {
  lifeStory: "",
  importantPeople: "",
  dailyRoutines: "",
  preferences: "",
  strengths: "",
  sensitiveTopics: "",
  updatedAt: null as string | null,
  updatedBy: null as string | null,
};

async function permittedResident(residentId: string) {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  const sql = carecoreDb();
  const rows =
    await sql`SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId} LIMIT 1`;
  return rows[0] ? { actor, sql } : null;
}

export async function GET(_request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const active = await permittedResident(residentId);
    if (!active) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.read")) return forbidden();
    const rows = await active.sql`
      SELECT b.life_story, b.important_people, b.daily_routines, b.preferences, b.strengths, b.sensitive_topics, b.updated_at, u.display_name AS updated_by
      FROM carecore_resident_biographies b
      LEFT JOIN carecore_users u ON u.id = b.updated_by
      WHERE b.resident_id = ${residentId}
      LIMIT 1
    `;
    const biography = rows[0] as Record<string, string | null> | undefined;
    return NextResponse.json({
      biography: biography
        ? {
            lifeStory: biography.life_story ?? "",
            importantPeople: biography.important_people ?? "",
            dailyRoutines: biography.daily_routines ?? "",
            preferences: biography.preferences ?? "",
            strengths: biography.strengths ?? "",
            sensitiveTopics: biography.sensitive_topics ?? "",
            updatedAt: biography.updated_at,
            updatedBy: biography.updated_by,
          }
        : emptyBiography,
    });
  } catch (error) {
    console.error("Biography GET failed", error);
    return NextResponse.json({ error: "Biografie konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const active = await permittedResident(residentId);
    if (!active) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const input = (await request.json()) as BiographyInput;
    const value = (key: keyof BiographyInput) =>
      typeof input[key] === "string" ? input[key].trim().slice(0, 8000) : "";
    const lifeStory = value("lifeStory");
    const importantPeople = value("importantPeople");
    const dailyRoutines = value("dailyRoutines");
    const preferences = value("preferences");
    const strengths = value("strengths");
    const sensitiveTopics = value("sensitiveTopics");
    const previous =
      await active.sql`SELECT life_story, important_people, daily_routines, preferences, strengths, sensitive_topics FROM carecore_resident_biographies WHERE resident_id = ${residentId}`;
    const old = previous[0];
    // Biografische Inhalte sind besonders schützenswert: protokolliert wird nur, welche Abschnitte sich änderten.
    const fields = changedFields(
      old && {
        lifeStory: old.life_story,
        importantPeople: old.important_people,
        dailyRoutines: old.daily_routines,
        preferences: old.preferences,
        strengths: old.strengths,
        sensitiveTopics: old.sensitive_topics,
      },
      { lifeStory, importantPeople, dailyRoutines, preferences, strengths, sensitiveTopics },
    );
    const [rows] = await active.sql.transaction([
      active.sql`
      INSERT INTO carecore_resident_biographies (resident_id, life_story, important_people, daily_routines, preferences, strengths, sensitive_topics, updated_by)
      VALUES (${residentId}, ${lifeStory}, ${importantPeople}, ${dailyRoutines}, ${preferences}, ${strengths}, ${sensitiveTopics}, ${active.actor.id})
      ON CONFLICT (resident_id) DO UPDATE SET life_story = EXCLUDED.life_story, important_people = EXCLUDED.important_people, daily_routines = EXCLUDED.daily_routines, preferences = EXCLUDED.preferences, strengths = EXCLUDED.strengths, sensitive_topics = EXCLUDED.sensitive_topics, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      RETURNING updated_at
    `,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_biography",
        entityId: residentId,
        action: old ? "updated" : "created",
        after: { changedSections: fields },
      }),
    ]);
    return NextResponse.json({
      biography: {
        lifeStory,
        importantPeople,
        dailyRoutines,
        preferences,
        strengths,
        sensitiveTopics,
        updatedAt: rows[0]?.updated_at ?? new Date().toISOString(),
        updatedBy: active.actor.display_name,
      },
    });
  } catch (error) {
    console.error("Biography PUT failed", error);
    return NextResponse.json({ error: "Biografie konnte nicht gespeichert werden." }, { status: 500 });
  }
}
