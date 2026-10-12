import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { createDocument, listing, uploadFile } from "@/lib/shared-files";

export const runtime = "nodejs";

// Inhalt eines Ordners (?folder=), Suche (?view=search&q=), zuletzt geändert (?view=recent) oder Papierkorb
// (?view=trash) – in „Meine Dateien“ oder mit ?scope=shared in der gemeinsamen Ablage.
export async function GET(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      await listing(actor, params.get("scope"), {
        folderId: params.get("folder"),
        view: params.get("view"),
        query: params.get("q"),
      }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Dateien konnten nicht geladen werden.");
  }
}

// Hochladen (multipart) oder neues Dokument ({ action: "document", kind, name, folderId, scope }).
export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const file = await createDocument(actor, (await request.json()) as Record<string, unknown>);
      return NextResponse.json({ file }, { status: 201 });
    }
    const result = await uploadFile(actor, await request.formData());
    if ("conflict" in result)
      return NextResponse.json(
        { error: `„${result.conflict.name}“ gibt es in diesem Ordner bereits.`, conflict: result.conflict },
        { status: 409 },
      );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Datei konnte nicht gespeichert werden.");
  }
}
