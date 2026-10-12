import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { exportMyData } from "@/lib/user-settings";

export const runtime = "nodejs";

// „Meine Daten herunterladen“ (Einstellungen › Datenschutz): JSON-Datei mit den eigenen Daten.
export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    const data = await exportMyData(actor);
    const day = data.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="carecore-meine-daten-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Deine Daten konnten nicht exportiert werden.");
  }
}
