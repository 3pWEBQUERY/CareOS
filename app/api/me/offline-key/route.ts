import { NextResponse } from "next/server";
import { carecoreActor } from "@/lib/server-data";
import { offlineKeyPair } from "@/lib/offline-key";

export const runtime = "nodejs";

// Schlüssel für offline vorgemerkte Einträge: nur für die angemeldete Person, nie zwischengespeichert.
export async function GET() {
  const actor = await carecoreActor();
  if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  const pair = offlineKeyPair(actor.id);
  if (!pair)
    return NextResponse.json(
      { error: "Offline-Speicherung ist auf diesem Server nicht eingerichtet (CARECORE_MFA_KEY fehlt)." },
      { status: 503 },
    );
  return NextResponse.json({ userId: actor.id, ...pair }, { headers: { "Cache-Control": "no-store, private" } });
}
