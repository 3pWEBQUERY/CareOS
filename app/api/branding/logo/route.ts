import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readLogo, removeLogo, saveLogo } from "@/lib/branding";

export const runtime = "nodejs";

// Logo der Einrichtung als Bild (für alle Angemeldeten), ändern und entfernen nur durch die Administration.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    const logo = await readLogo(ctx);
    if (!logo) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new NextResponse(new Uint8Array(logo.bytes), {
      headers: {
        "Content-Type": logo.mimeType,
        "Content-Length": String(logo.bytes.byteLength),
        // Mit Versionsangabe (?v=Zeitpunkt der Änderung) ändert sich die Adresse bei jedem neuen Logo: der Browser darf
        // das Bild dauerhaft behalten und zeigt es beim Neuladen sofort.
        "Cache-Control": new URL(request.url).searchParams.has("v")
          ? "private, max-age=31536000, immutable"
          : "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Logo konnte nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { logoDataUrl?: unknown };
    return NextResponse.json({ updatedAt: await saveLogo(ctx, body.logoDataUrl) });
  } catch (error) {
    return apiErrorResponse(error, "Logo konnte nicht gespeichert werden.");
  }
}

export async function DELETE() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    await removeLogo(ctx);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Logo konnte nicht entfernt werden.");
  }
}
