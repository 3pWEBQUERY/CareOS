import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor, carecoreDb } from "@/lib/server-data";
import { auditOrigin } from "@/lib/audit-origin";

export const runtime = "nodejs";

// Contacts for questions: everyone with administration rights in the own organisation.
async function administrators(organizationId: string) {
  return (await carecoreDb()`
    SELECT u.id, u.display_name, COALESCE(p.job_title, '') AS job_title, COALESCE(p.phone, '') AS phone
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id JOIN carecore_roles r ON r.key = u.role
    WHERE p.organization_id = ${organizationId} AND u.active AND u.archived_at IS NULL
      AND r.permissions ? 'administration.manage'
    ORDER BY u.display_name`) as Array<Record<string, unknown>>;
}

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const contacts = (await administrators(actor.organizationId)).map((row) => ({
      name: String(row.display_name),
      jobTitle: String(row.job_title),
      phone: String(row.phone),
    }));
    return NextResponse.json({ contacts });
  } catch (error) {
    return apiErrorResponse(error, "Hilfe konnte nicht geladen werden.");
  }
}

// "Problem melden": the administration receives the message as notification with the page it concerns.
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const body = (await request.json()) as { message?: unknown; page?: unknown };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (message.length < 5) return NextResponse.json({ error: "Bitte das Problem kurz beschreiben." }, { status: 400 });
    const page = typeof body.page === "string" && body.page.startsWith("/c") ? body.page.slice(0, 300) : null;
    const admins = await administrators(actor.organizationId);
    if (!admins.length) return NextResponse.json({ error: "Es ist keine Administration hinterlegt." }, { status: 409 });
    const sql = carecoreDb();
    await sql.transaction([
      ...admins.map(
        (admin) => sql`
          INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
          VALUES (${randomUUID()}, ${String(admin.id)}, ${`Problem gemeldet von ${actor.display_name}`},
            ${page ? `${message}\n\nSeite: ${page}` : message}, 'support_request', 'high', ${page})`,
      ),
      sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
        VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${auditOrigin(actor).sessionId}, ${auditOrigin(actor).userAgent}, 'support_request', ${actor.id}, 'reported',
          ${JSON.stringify({ page, length: message.length })}::jsonb)`,
    ]);
    return NextResponse.json({ notified: admins.length }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Meldung konnte nicht gesendet werden.");
  }
}
