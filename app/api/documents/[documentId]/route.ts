import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { documentAction, newVersion } from "@/lib/documents";

export const runtime = "nodejs";

// multipart/form-data (file, changeNote, status) uploads a new version;
// JSON { action: "read" | "ack" | "update" | "publish" | "archive", ... } changes the document.
export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { documentId } = await params;
    if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data"))
      return NextResponse.json({ id: await newVersion(ctx, documentId, await request.formData()) }, { status: 201 });
    await documentAction(ctx, documentId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Dokument konnte nicht geändert werden.");
  }
}
