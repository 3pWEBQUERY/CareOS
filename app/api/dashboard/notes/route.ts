import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor, carecoreDb } from "@/lib/server-data";
import { createNote, deleteNote, listNotes, updateNote } from "@/lib/staff-notes";

export const runtime = "nodejs";

// Persönliche Notizen der Startseite (lib/staff-notes.ts). Alle Änderungen sind wiederholbar (Offline-Betrieb).
async function owner() {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  return { sql: carecoreDb(), userId: actor.id, organizationId: actor.organizationId };
}

const unauthorized = () => NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
const body = async (request: Request) => ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export async function GET() {
  try {
    const context = await owner();
    if (!context) return unauthorized();
    return NextResponse.json({ notes: await listNotes(context) });
  } catch (error) {
    return apiErrorResponse(error, "Notizen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await owner();
    if (!context) return unauthorized();
    return NextResponse.json({ note: await createNote(context, await body(request)) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Notiz konnte nicht gespeichert werden.");
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await owner();
    if (!context) return unauthorized();
    return NextResponse.json({ note: await updateNote(context, await body(request)) });
  } catch (error) {
    return apiErrorResponse(error, "Notiz konnte nicht gespeichert werden.");
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await owner();
    if (!context) return unauthorized();
    return NextResponse.json(await deleteNote(context, await body(request)));
  } catch (error) {
    return apiErrorResponse(error, "Notiz konnte nicht gelöscht werden.");
  }
}
