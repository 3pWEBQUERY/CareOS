import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { purgeFolder, updateFolder } from "@/lib/shared-files";

export const runtime = "nodejs";
type Context = { params: Promise<{ folderId: string }> };

// Umbenennen, verschieben, in den Papierkorb ({ action: "trash" }) und zurück ({ action: "restore" }).
export async function PATCH(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { folderId } = await params;
    await updateFolder(actor, folderId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Ordner konnte nicht geändert werden.");
  }
}

// Endgültig löschen (nur aus dem Papierkorb).
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { folderId } = await params;
    await purgeFolder(actor, folderId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Ordner konnte nicht gelöscht werden.");
  }
}
