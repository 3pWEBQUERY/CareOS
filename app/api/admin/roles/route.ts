import { NextResponse } from "next/server";
import { carecoreActor, hasPermission } from "@/lib/server-data";
import { createManagedRole, deleteManagedRole, listManagedRoles, updateManagedRole } from "@/lib/admin-users";

export const runtime = "nodejs";

async function adminUser() {
  const actor = await carecoreActor();
  return hasPermission(actor, "administration.manage") ? actor : null;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "DATABASE_URL_NOT_CONFIGURED")
    return NextResponse.json({ error: "Datenbank ist nicht konfiguriert." }, { status: 503 });
  if (message === "INVALID_ROLE_INPUT")
    return NextResponse.json({ error: "Bitte einen Namen für die Rolle angeben." }, { status: 400 });
  if (message === "ROLE_NOT_FOUND")
    return NextResponse.json({ error: "Die Rolle wurde nicht gefunden." }, { status: 404 });
  if (message === "SYSTEM_ROLE_PROTECTED")
    return NextResponse.json({ error: "Systemrollen können nicht gelöscht werden." }, { status: 400 });
  if (message === "ROLE_IN_USE")
    return NextResponse.json(
      { error: "Diese Rolle ist noch Mitarbeitern zugeordnet und kann nicht gelöscht werden." },
      { status: 400 },
    );
  if (message.includes("duplicate key"))
    return NextResponse.json(
      { error: "Diese Rolle gibt es bereits. Bitte einen anderen Namen wählen." },
      { status: 409 },
    );
  console.error("Admin roles request failed", error);
  return NextResponse.json({ error: "Rollenverwaltung konnte nicht aktualisiert werden." }, { status: 500 });
}

export async function GET() {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    return NextResponse.json({ roles: await listManagedRoles(actor.id) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.key !== "string" || typeof body.name !== "string")
      return NextResponse.json({ error: "Unvollständige Rollenangaben." }, { status: 400 });
    return NextResponse.json(
      {
        roles: await createManagedRole(actor, {
          key: body.key,
          name: body.name,
          description: typeof body.description === "string" ? body.description : undefined,
          permissions: body.permissions,
          medicationRequiresQualification: body.medicationRequiresQualification === true,
          copyOf: typeof body.copyOf === "string" ? body.copyOf : undefined,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.roleId !== "string" || typeof body.name !== "string")
      return NextResponse.json({ error: "Unvollständige Rollenangaben." }, { status: 400 });
    return NextResponse.json({
      roles: await updateManagedRole(actor, body.roleId, {
        name: body.name,
        description: typeof body.description === "string" ? body.description : undefined,
        permissions: body.permissions,
        medicationRequiresQualification:
          typeof body.medicationRequiresQualification === "boolean" ? body.medicationRequiresQualification : undefined,
      }),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as { roleId?: unknown };
    if (typeof body.roleId !== "string") return NextResponse.json({ error: "Rolle fehlt." }, { status: 400 });
    return NextResponse.json({ roles: await deleteManagedRole(actor, body.roleId) });
  } catch (error) {
    return fail(error);
  }
}
