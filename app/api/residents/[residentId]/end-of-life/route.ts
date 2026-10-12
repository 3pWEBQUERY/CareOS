import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { applyDeathChecklist, endOfLifeView, saveEndOfLifeWishes } from "@/lib/end-of-life";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Wünsche für die letzte Lebensphase und, nach einem Todesfall, die Checkliste der Einrichtung.
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await endOfLifeView(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Wünsche konnten nicht geladen werden.");
  }
}

// Wünsche speichern ({ place, companionship, spiritual, funeral, notify, otherWishes, discussedWith, discussedOn }).
export async function PUT(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await saveEndOfLifeWishes(ctx, (await params).residentId, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Wünsche konnten nicht gespeichert werden.");
  }
}

// Checkliste nachträglich übernehmen (Todesfall wurde erfasst, bevor die Einrichtung sie festgelegt hatte).
export async function POST(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await applyDeathChecklist(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Checkliste konnte nicht übernommen werden.");
  }
}
