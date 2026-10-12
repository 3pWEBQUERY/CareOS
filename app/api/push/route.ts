import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { apiErrorResponse, type ApiContext } from "@/lib/api-context";
import { SESSION_COOKIE } from "@/lib/auth";
import { deletePushSubscription, isPushSubscribed, pushKeys, savePushSubscription } from "@/lib/push";
import { carecoreActor, carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

async function context(): Promise<ApiContext | NextResponse> {
  const actor = await carecoreActor();
  if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (!actor.organizationId) return NextResponse.json({ error: "Keine Organisation zugeordnet." }, { status: 400 });
  return { actor: { ...actor, organizationId: actor.organizationId }, sql: carecoreDb() };
}

const sessionToken = async () => (await cookies()).get(SESSION_COOKIE)?.value;

// GET ?endpoint=… – ist Push eingerichtet (öffentlicher Schlüssel) und dieses Gerät abonniert?
export async function GET(request: Request) {
  try {
    const ctx = await context();
    if (ctx instanceof NextResponse) return ctx;
    const keys = pushKeys();
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    const subscribed = keys && endpoint ? await isPushSubscribed(ctx, await sessionToken(), endpoint) : false;
    return NextResponse.json({ publicKey: keys?.publicKey ?? null, subscribed });
  } catch (error) {
    return apiErrorResponse(error, "Push-Status konnte nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await context();
    if (ctx instanceof NextResponse) return ctx;
    await savePushSubscription(ctx, await sessionToken(), await request.json());
    return NextResponse.json({ subscribed: true });
  } catch (error) {
    return apiErrorResponse(error, "Push konnte nicht eingeschaltet werden.");
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await context();
    if (ctx instanceof NextResponse) return ctx;
    await deletePushSubscription(ctx, ((await request.json()) as { endpoint?: unknown }).endpoint);
    return NextResponse.json({ subscribed: false });
  } catch (error) {
    return apiErrorResponse(error, "Push konnte nicht ausgeschaltet werden.");
  }
}
