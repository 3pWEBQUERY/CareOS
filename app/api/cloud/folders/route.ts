import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { createFolder, folderTree } from "@/lib/shared-files";

export const runtime = "nodejs";

// Ordnerbaum einer Ablage (für „Verschieben“ und „Kopieren“).
export async function GET(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    return NextResponse.json({ folders: await folderTree(actor, new URL(request.url).searchParams.get("scope")) });
  } catch (error) {
    return apiErrorResponse(error, "Ordner konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const id = await createFolder(actor, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Ordner konnte nicht angelegt werden.");
  }
}
