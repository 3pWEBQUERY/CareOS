import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { residentFiles, uploadResidentFile } from "@/lib/resident-record";
import { hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json({
      documents: await residentFiles(ctx, residentId),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Dokumente konnten nicht geladen werden.");
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json(
      { id: await uploadResidentFile(ctx, residentId, await request.formData()) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Dokument konnte nicht hochgeladen werden.");
  }
}
