import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";
export const runtime = "nodejs";
const priorities = ["low", "normal", "high", "critical"];
export async function GET() {
  const actor = await carecoreActor();
  if (!actor?.organizationId || !hasPermission(actor, "team.manage")) return forbidden();
  const sql = carecoreDb();
  const tasks =
    await sql`SELECT t.id, t.title, t.description, t.priority, t.status, t.due_at, t.created_at, COALESCE(u.display_name, 'Nicht zugewiesen') AS assignee, COALESCE(cu.name, '') AS care_unit_name FROM carecore_tasks t LEFT JOIN carecore_users u ON u.id = t.assigned_to LEFT JOIN carecore_care_units cu ON cu.id = t.care_unit_id WHERE t.organization_id = ${actor.organizationId} ORDER BY t.status = 'cancelled', t.due_at NULLS LAST, t.created_at DESC`;
  const employees =
    await sql`SELECT u.id, u.display_name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id WHERE p.organization_id = ${actor.organizationId} AND u.active = TRUE ORDER BY u.display_name`;
  return NextResponse.json({ tasks, employees });
}
export async function POST(request: Request) {
  const actor = await carecoreActor();
  if (!actor?.organizationId || !hasPermission(actor, "team.manage")) return forbidden();
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    priority?: string;
    assignedTo?: string;
    dueAt?: string;
  };
  if (!body.title?.trim()) return NextResponse.json({ error: "Titel ist erforderlich." }, { status: 400 });
  const sql = carecoreDb();
  const id = randomUUID();
  const priority = priorities.includes(body.priority ?? "") ? body.priority : "normal";
  if (
    body.assignedTo &&
    !(
      await sql`SELECT user_id FROM carecore_user_profiles WHERE user_id = ${body.assignedTo} AND organization_id = ${actor.organizationId} LIMIT 1`
    )[0]
  )
    return NextResponse.json({ error: "Mitarbeiter ist in diesem Arbeitsbereich nicht verfügbar." }, { status: 400 });
  await sql`INSERT INTO carecore_tasks (id, organization_id, assigned_to, created_by, title, description, priority, due_at) VALUES (${id}, ${actor.organizationId}, ${body.assignedTo || null}, ${actor.id}, ${body.title.trim()}, ${body.description || null}, ${priority}, ${body.dueAt || null})`;
  return NextResponse.json({ id }, { status: 201 });
}
export async function PATCH(request: Request) {
  const actor = await carecoreActor();
  if (!actor?.organizationId || !hasPermission(actor, "team.manage")) return forbidden();
  const body = (await request.json()) as {
    id?: string;
    action?: string;
    title?: string;
    priority?: string;
    assignedTo?: string;
  };
  if (!body.id) return NextResponse.json({ error: "Aufgabe fehlt." }, { status: 400 });
  if (body.priority !== undefined && !priorities.includes(body.priority))
    return NextResponse.json({ error: "Ungültige Priorität." }, { status: 400 });
  const sql = carecoreDb();
  if (
    body.assignedTo &&
    !(
      await sql`SELECT user_id FROM carecore_user_profiles WHERE user_id = ${body.assignedTo} AND organization_id = ${actor.organizationId} LIMIT 1`
    )[0]
  )
    return NextResponse.json({ error: "Mitarbeiter ist in diesem Arbeitsbereich nicht verfügbar." }, { status: 400 });
  let rows;
  if (body.action === "archive")
    rows =
      await sql`UPDATE carecore_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = ${body.id} AND organization_id = ${actor.organizationId} RETURNING id`;
  else if (body.action === "restore")
    rows =
      await sql`UPDATE carecore_tasks SET status = 'open', updated_at = NOW() WHERE id = ${body.id} AND organization_id = ${actor.organizationId} RETURNING id`;
  else
    rows =
      await sql`UPDATE carecore_tasks SET title = COALESCE(${body.title ?? null}, title), priority = COALESCE(${body.priority ?? null}, priority), assigned_to = COALESCE(${body.assignedTo ?? null}, assigned_to), updated_at = NOW() WHERE id = ${body.id} AND organization_id = ${actor.organizationId} RETURNING id`;
  if (!rows[0]) return NextResponse.json({ error: "Aufgabe nicht gefunden." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
