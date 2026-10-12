import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createTask, listTasks, setTaskStatus } from "@/lib/tasks";

export const runtime = "nodejs";

// ?scope=mine|team, ?residentId=
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await listTasks(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Aufgaben konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createTask(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Aufgabe konnte nicht gespeichert werden.");
  }
}

// Quick toggle used by the dashboard: { id, completed }.
export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { id?: unknown; completed?: unknown };
    await setTaskStatus(ctx, body.id, { status: body.completed === true ? "completed" : "open" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Aufgabe konnte nicht aktualisiert werden.");
  }
}
