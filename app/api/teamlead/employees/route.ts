import { NextResponse } from "next/server";
import { passwordPolicyError } from "@/lib/password-policy";
import { passwordMinLength } from "@/lib/password-rules";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth";
import { carecoreActor, carecoreDb, forbidden, hasPermission, type CarecoreActor } from "@/lib/server-data";

export const runtime = "nodejs";
const permittedActor = (actor: CarecoreActor | null): actor is CarecoreActor & { organizationId: string } =>
  !!actor?.organizationId && hasPermission(actor, "team.manage");
const careUnitInOrganization = (sql: ReturnType<typeof carecoreDb>, careUnitId: string, organizationId: string) =>
  sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id WHERE cu.id = ${careUnitId} AND si.organization_id = ${organizationId} AND cu.active = TRUE LIMIT 1`;

export async function GET() {
  const actor = await carecoreActor();
  if (!permittedActor(actor)) return forbidden();
  const sql = carecoreDb();
  const rows =
    await sql`SELECT u.id, u.username, u.display_name, u.role, u.active, u.archived_at, COALESCE(p.job_title, '') AS job_title, COALESCE(p.phone, '') AS phone, p.primary_care_unit_id, COALESCE(cu.name, '') AS care_unit_name FROM carecore_users u LEFT JOIN carecore_user_profiles p ON p.user_id = u.id LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id WHERE p.organization_id = ${actor.organizationId} ORDER BY u.active DESC, u.display_name`;
  const units =
    await sql`SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id WHERE si.organization_id = ${actor.organizationId} AND cu.active = TRUE ORDER BY cu.name`;
  return NextResponse.json({ employees: rows, units });
}

export async function POST(request: Request) {
  const actor = await carecoreActor();
  if (!permittedActor(actor)) return forbidden();
  const body = (await request.json()) as Record<string, unknown>;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role =
    typeof body.role === "string" && ["leitung", "pflege", "arzt", "mitarbeitende:r"].includes(body.role)
      ? body.role
      : "mitarbeitende:r";
  if (!displayName || !username || password.length < 10)
    return NextResponse.json(
      { error: "Name, Benutzername und ein Passwort mit mindestens 10 Zeichen sind erforderlich." },
      { status: 400 },
    );
  const sql = carecoreDb();
  const policy = passwordPolicyError(password, {
    minLength: await passwordMinLength(sql, actor.id),
    username,
    displayName,
  });
  if (policy) return NextResponse.json({ error: policy }, { status: 400 });
  if (
    typeof body.primaryCareUnitId === "string" &&
    body.primaryCareUnitId &&
    !(await careUnitInOrganization(sql, body.primaryCareUnitId, actor.organizationId))[0]
  )
    return NextResponse.json({ error: "Der gewählte Wohnbereich ist nicht verfügbar." }, { status: 400 });
  const userId = randomUUID();
  try {
    await sql`INSERT INTO carecore_users (id, username, display_name, role, password_hash) VALUES (${userId}, ${username}, ${displayName}, ${role}, ${await hashPassword(password)})`;
    await sql`INSERT INTO carecore_user_profiles (user_id, organization_id, job_title, primary_care_unit_id) VALUES (${userId}, ${actor.organizationId}, ${typeof body.jobTitle === "string" ? body.jobTitle : "Mitarbeitende:r"}, ${typeof body.primaryCareUnitId === "string" && body.primaryCareUnitId ? body.primaryCareUnitId : null})`;
    return NextResponse.json({ id: userId }, { status: 201 });
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate"))
      return NextResponse.json({ error: "Der Benutzername ist bereits vergeben." }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const actor = await carecoreActor();
  if (!permittedActor(actor)) return forbidden();
  const body = (await request.json()) as {
    id?: string;
    action?: string;
    displayName?: string;
    username?: string;
    role?: string;
    jobTitle?: string;
    phone?: string;
    primaryCareUnitId?: string | null;
  };
  if (!body.id) return NextResponse.json({ error: "Mitarbeiter fehlt." }, { status: 400 });
  const sql = carecoreDb();
  const permitted =
    await sql`SELECT u.id, u.role FROM carecore_users u INNER JOIN carecore_user_profiles p ON p.user_id = u.id WHERE u.id = ${body.id} AND p.organization_id = ${actor.organizationId} LIMIT 1`;
  if (!permitted[0])
    return NextResponse.json({ error: "Mitarbeiter ist in diesem Arbeitsbereich nicht verfügbar." }, { status: 404 });
  if (permitted[0].role === "admin" && !hasPermission(actor, "administration.manage"))
    return forbidden("Administrationskonten können nur von der Administration bearbeitet werden.");
  if (body.action === "archive") {
    if (body.id === actor.id)
      return NextResponse.json({ error: "Das eigene Konto kann nicht archiviert werden." }, { status: 400 });
    await sql`UPDATE carecore_users SET active = FALSE, archived_at = NOW(), archived_by = ${actor.id}, updated_at = NOW() WHERE id = ${body.id}`;
  } else if (body.action === "restore")
    await sql`UPDATE carecore_users SET active = TRUE, archived_at = NULL, archived_by = NULL, updated_at = NOW() WHERE id = ${body.id}`;
  else {
    const displayName = body.displayName?.trim();
    const username = body.username?.trim();
    const role = body.role;
    if (!displayName || !username || !role || !["leitung", "pflege", "arzt", "mitarbeitende:r"].includes(role))
      return NextResponse.json(
        { error: "Name, Benutzername und eine gültige Rolle sind erforderlich." },
        { status: 400 },
      );
    if (body.primaryCareUnitId) {
      const unit = await careUnitInOrganization(sql, body.primaryCareUnitId, actor.organizationId);
      if (!unit[0])
        return NextResponse.json({ error: "Der gewählte Wohnbereich ist nicht verfügbar." }, { status: 400 });
    }
    await sql`UPDATE carecore_users SET display_name = ${displayName}, username = ${username}, role = ${role}, updated_at = NOW() WHERE id = ${body.id}`;
    await sql`INSERT INTO carecore_user_profiles (user_id, organization_id, job_title, phone, primary_care_unit_id) VALUES (${body.id}, ${actor.organizationId}, ${body.jobTitle?.trim() || null}, ${body.phone?.trim() || null}, ${body.primaryCareUnitId || null}) ON CONFLICT (user_id) DO UPDATE SET job_title = EXCLUDED.job_title, phone = EXCLUDED.phone, primary_care_unit_id = EXCLUDED.primary_care_unit_id, updated_at = NOW()`;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const actor = await carecoreActor();
  if (!permittedActor(actor)) return forbidden();
  const body = (await request.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "Mitarbeiter fehlt." }, { status: 400 });
  if (body.id === actor.id)
    return NextResponse.json({ error: "Das eigene Konto kann nicht gelöscht werden." }, { status: 400 });
  const sql = carecoreDb();
  const permitted =
    await sql`SELECT u.id, u.role FROM carecore_users u INNER JOIN carecore_user_profiles p ON p.user_id = u.id WHERE u.id = ${body.id} AND p.organization_id = ${actor.organizationId} LIMIT 1`;
  if (!permitted[0])
    return NextResponse.json({ error: "Mitarbeiter ist in diesem Arbeitsbereich nicht verfügbar." }, { status: 404 });
  if (permitted[0].role === "admin" && !hasPermission(actor, "administration.manage"))
    return forbidden("Administrationskonten können nur von der Administration bearbeitet werden.");
  await sql`DELETE FROM carecore_users WHERE id = ${body.id}`;
  return NextResponse.json({ ok: true });
}
