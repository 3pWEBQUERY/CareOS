import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { eventsData, reportEvent } from "@/lib/quality";

export const runtime = "nodejs";

// Everyone who documents care may report events; quality management sees and handles all of them.
export async function GET() {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await eventsData(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Ereignisse konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const id = await reportEvent(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Ereignis konnte nicht gemeldet werden.");
  }
}
