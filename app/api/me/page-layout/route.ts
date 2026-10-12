import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import {
  deletePageLayout,
  normalizePageLayout,
  pageLayoutKey,
  readPageLayout,
  savePageLayout,
} from "@/lib/page-layouts";
import { carecoreActor, carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Persönliche Anordnung einer einrichtbaren Seite: GET/PUT/DELETE ?page=<Schlüssel>.
async function request(url: string) {
  const actor = await carecoreActor();
  if (!actor) return { error: NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 }) };
  const page = pageLayoutKey(new URL(url).searchParams.get("page"));
  if (!page) return { error: NextResponse.json({ error: "Unbekannte Seite." }, { status: 400 }) };
  return { actor, page };
}

export async function GET(req: Request) {
  try {
    const r = await request(req.url);
    if ("error" in r) return r.error;
    return NextResponse.json({ layout: await readPageLayout(carecoreDb(), r.actor.id, r.page) });
  } catch (error) {
    return apiErrorResponse(error, "Die Anordnung konnte nicht geladen werden.");
  }
}

export async function PUT(req: Request) {
  try {
    const r = await request(req.url);
    if ("error" in r) return r.error;
    const layout = normalizePageLayout(await req.json().catch(() => null));
    if (!layout) return NextResponse.json({ error: "Ungültige Anordnung." }, { status: 400 });
    await savePageLayout(carecoreDb(), r.actor.id, r.page, layout);
    return NextResponse.json({ layout });
  } catch (error) {
    return apiErrorResponse(error, "Die Anordnung konnte nicht gespeichert werden.");
  }
}

export async function DELETE(req: Request) {
  try {
    const r = await request(req.url);
    if ("error" in r) return r.error;
    await deletePageLayout(carecoreDb(), r.actor.id, r.page);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Anordnung konnte nicht zurückgesetzt werden.");
  }
}
