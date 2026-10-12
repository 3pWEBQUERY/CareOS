import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createDocument, listDocuments } from "@/lib/documents";

export const runtime = "nodejs";

// ?kind=document|standard
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await listDocuments(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Dokumente konnten nicht geladen werden.");
  }
}

// multipart/form-data: kind, title, category, description, status (active|draft), requiresAck, reviewDueOn, file
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ id: await createDocument(ctx, await request.formData()) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Dokument konnte nicht gespeichert werden.");
  }
}
