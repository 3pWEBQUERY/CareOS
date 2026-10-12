import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { zipSelection } from "@/lib/shared-files";

export const runtime = "nodejs";

const ids = (value: string | null) => (value ? value.split(",").filter(Boolean).slice(0, 500) : []);

// Mehrere Dateien bzw. ganze Ordner als ZIP herunterladen (?files=a,b&folders=c&scope=shared).
export async function GET(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const zip = await zipSelection(actor, params.get("scope"), ids(params.get("files")), ids(params.get("folders")));
    const safeName = zip.name.replace(/["\r\n]/g, "_");
    return new Response(new Uint8Array(zip.content), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(zip.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Download konnte nicht erstellt werden.");
  }
}
