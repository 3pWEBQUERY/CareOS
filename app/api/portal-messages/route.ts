import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { messageRecipients, staffSend, staffThreads } from "@/lib/portal-messages";

export const runtime = "nodejs";

// Pflege: Unterhaltungen mit Portal-Zugängen, auf die die Person antworten darf.
export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const [threads, recipients] = await Promise.all([staffThreads(ctx), messageRecipients(ctx)]);
    return NextResponse.json({ threads, recipients });
  } catch (error) {
    return apiErrorResponse(error, "Portal-Nachrichten konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { threadId: await staffSend(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Die Nachricht konnte nicht gesendet werden.");
  }
}
