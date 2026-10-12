import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { listPhotos, storePhoto } from "@/lib/wound-photos";

export const runtime = "nodejs";
type Context = { params: Promise<{ woundId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { woundId } = await params;
    return NextResponse.json({ photos: await listPhotos(ctx, woundId) });
  } catch (error) {
    return apiErrorResponse(error, "Fotos konnten nicht geladen werden.");
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { woundId } = await params;
    return NextResponse.json({ id: await storePhoto(ctx, woundId, await request.formData()) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Foto konnte nicht gespeichert werden.");
  }
}
