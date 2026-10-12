import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { adminOverview, type AdminView } from "@/lib/admin-overview";

export const runtime = "nodejs";

const VIEWS: AdminView[] = ["organization", "users", "configuration"];

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const requested = new URL(request.url).searchParams.get("view") as AdminView | null;
    return NextResponse.json(
      await adminOverview(ctx, requested && VIEWS.includes(requested) ? requested : "organization"),
    );
  } catch (error) {
    return apiErrorResponse(error, "Übersicht konnte nicht geladen werden.");
  }
}
