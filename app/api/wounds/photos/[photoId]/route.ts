import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hidePhoto, readPhoto } from "@/lib/wound-photos";

export const runtime = "nodejs";
type Context = { params: Promise<{ photoId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { photoId } = await params;
    const photo = await readPhoto(ctx, photoId);
    return new Response(new Uint8Array(photo.content), {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": String(photo.content.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Foto konnte nicht geladen werden.");
  }
}

// Photos are hidden with a reason instead of being deleted (care record).
export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { photoId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    await hidePhoto(ctx, photoId, body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Foto konnte nicht entfernt werden.");
  }
}
