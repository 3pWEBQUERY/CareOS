import { NextResponse } from "next/server";
import { ssoProviders } from "@/lib/sso";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Eingeschaltete SSO-Anbieter für die Anmeldeseite (nur Bezeichnung und Kennung).
export async function GET() {
  try {
    return NextResponse.json(
      { providers: await ssoProviders(carecoreDb()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("SSO providers failed", error);
    return NextResponse.json({ providers: [] });
  }
}
