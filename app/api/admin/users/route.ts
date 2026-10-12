import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb, hasPermission } from "@/lib/server-data";
import { resetMfa } from "@/lib/mfa";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { mailConfigured } from "@/lib/mail";
import { sendPasswordLink } from "@/lib/password-links";
import { createManagedUser, deleteManagedUser, listManagedUsers, updateManagedUser } from "@/lib/admin-users";

export const runtime = "nodejs";

// Jede Antwort sagt auch, ob der E-Mail-Versand eingerichtet ist (Knopf „Link senden“, Einladung).
const withMail = async (data: Promise<object>, status = 200) =>
  NextResponse.json({ ...(await data), mailEnabled: mailConfigured() }, { status });

async function adminUser() {
  const actor = await carecoreActor();
  return hasPermission(actor, "administration.manage") ? actor : null;
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === "DATABASE_URL_NOT_CONFIGURED")
    return NextResponse.json({ error: "Datenbank ist nicht konfiguriert." }, { status: 503 });
  if (error instanceof Error && ["CANNOT_LOCK_SELF", "CANNOT_DELETE_SELF"].includes(error.message))
    return NextResponse.json(
      { error: "Das eigene Administrationskonto kann nicht gesperrt oder gelöscht werden." },
      { status: 400 },
    );
  if (error instanceof Error && error.message === "USER_NOT_FOUND")
    return NextResponse.json({ error: "Mitarbeiter ist in dieser Organisation nicht verfügbar." }, { status: 404 });
  if (error instanceof Error && error.message === "CARE_UNIT_NOT_FOUND")
    return NextResponse.json({ error: "Der gewählte Wohnbereich ist nicht verfügbar." }, { status: 400 });
  if (error instanceof Error && error.message === "QUALIFICATION_NOT_FOUND")
    return NextResponse.json({ error: "Die Qualifikation gehört nicht zu dieser Organisation." }, { status: 400 });
  if (error instanceof Error && error.message === "INVALID_EMAIL")
    return NextResponse.json({ error: "Die E-Mail-Adresse ist ungültig." }, { status: 400 });
  if (error instanceof Error && error.message === "EMAIL_TAKEN")
    return NextResponse.json({ error: "Diese E-Mail-Adresse gehört bereits zu einem anderen Konto." }, { status: 409 });
  if (error instanceof Error && error.message === "INVALID_USER_INPUT")
    return NextResponse.json({ error: "Name, Benutzername und Rolle sind erforderlich." }, { status: 400 });
  if (error instanceof Error && error.message === "INVALID_EMPLOYEE_INPUT")
    return NextResponse.json(
      { error: "Name, Benutzername, Rolle und ein mindestens 10-stelliges Startpasswort sind erforderlich." },
      { status: 400 },
    );
  console.error("Admin users request failed", error);
  return NextResponse.json({ error: "Benutzerverwaltung konnte nicht aktualisiert werden." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as Record<string, unknown>;
    // Einladung per E-Mail statt Startpasswort: das Konto erhält ein zufälliges Passwort, die Person setzt ihr
    // eigenes über den Link.
    const invite = body.invite === true;
    if (invite && (!mailConfigured() || typeof body.email !== "string" || !body.email.trim()))
      return NextResponse.json(
        { error: "Für eine Einladung braucht es eine E-Mail-Adresse und den eingerichteten E-Mail-Versand." },
        { status: 400 },
      );
    if (
      typeof body.displayName !== "string" ||
      typeof body.username !== "string" ||
      (!invite && typeof body.password !== "string") ||
      typeof body.role !== "string"
    )
      return NextResponse.json({ error: "Unvollständige Mitarbeiterangaben." }, { status: 400 });
    const created = await createManagedUser(actor, {
      displayName: body.displayName,
      username: body.username,
      password: invite ? randomBytes(32).toString("base64url") : String(body.password),
      generatedPassword: invite,
      role: body.role,
      jobTitle: typeof body.jobTitle === "string" ? body.jobTitle : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      primaryCareUnitId:
        typeof body.primaryCareUnitId === "string" || body.primaryCareUnitId === null
          ? body.primaryCareUnitId
          : undefined,
    });
    let inviteFailed = false;
    if (invite) {
      const user = created.users.find((entry) => entry.username === String(body.username).trim().slice(0, 80));
      // Das Konto bleibt bestehen, wenn der Versand scheitert; die Einladung lässt sich erneut senden.
      if (user)
        await sendPasswordLink(actor, user.id).catch((error) => {
          console.error("Invite mail failed", error);
          inviteFailed = true;
        });
    }
    return withMail(Promise.resolve({ ...created, inviteFailed }), 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    return withMail(listManagedUsers(actor.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as {
      userId?: unknown;
      displayName?: unknown;
      username?: unknown;
      role?: unknown;
      jobTitle?: unknown;
      phone?: unknown;
      email?: unknown;
      primaryCareUnitId?: unknown;
      qualificationIds?: unknown;
      action?: unknown;
    };
    if (typeof body.userId !== "string") return NextResponse.json({ error: "Benutzer fehlt." }, { status: 400 });
    if (body.action === "resetMfa") {
      await resetMfa(carecoreDb(), actor, body.userId);
      return withMail(listManagedUsers(actor.id));
    }
    const action = body.action === "lock" || body.action === "restore" ? body.action : undefined;
    return withMail(
      updateManagedUser(actor, body.userId, {
        displayName: typeof body.displayName === "string" ? body.displayName : undefined,
        username: typeof body.username === "string" ? body.username : undefined,
        role: typeof body.role === "string" ? body.role : undefined,
        jobTitle: typeof body.jobTitle === "string" ? body.jobTitle : undefined,
        phone: typeof body.phone === "string" ? body.phone : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
        primaryCareUnitId:
          typeof body.primaryCareUnitId === "string" || body.primaryCareUnitId === null
            ? body.primaryCareUnitId
            : undefined,
        qualificationIds: Array.isArray(body.qualificationIds)
          ? body.qualificationIds.filter((id): id is string => typeof id === "string")
          : undefined,
        action,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await adminUser();
    if (!actor) return NextResponse.json({ error: "Keine Administrationsberechtigung." }, { status: 403 });
    const body = (await request.json()) as { userId?: unknown };
    if (typeof body.userId !== "string") return NextResponse.json({ error: "Benutzer fehlt." }, { status: 400 });
    return withMail(deleteManagedUser(actor, body.userId));
  } catch (error) {
    return errorResponse(error);
  }
}
