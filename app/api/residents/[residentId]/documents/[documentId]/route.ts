import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { archiveResidentFile } from "@/lib/resident-record";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string; documentId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId, documentId } = await params;
    return NextResponse.json({ title: await archiveResidentFile(ctx, residentId, documentId) });
  } catch (error) {
    return apiErrorResponse(error, "Dokument konnte nicht archiviert werden.");
  }
}
