import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createPost, teamNews } from "@/lib/team-news";

export const runtime = "nodejs";

// ?channelId= limits the feed to one channel; without it the feed shows all joined channels.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await teamNews(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Neuigkeiten konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createPost(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Beitrag konnte nicht veröffentlicht werden.");
  }
}
