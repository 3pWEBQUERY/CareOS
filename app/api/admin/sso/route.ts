import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readSsoSettings, saveSsoSettings, ssoRedirectUri, testSsoConnection } from "@/lib/sso";

export const runtime = "nodejs";

// SSO der Einrichtung (Administration). Das Client-Secret wird nie zurückgegeben.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      settings: await readSsoSettings(ctx),
      redirectUri: ssoRedirectUri(new URL(request.url).origin),
    });
  } catch (error) {
    return apiErrorResponse(error, "SSO-Einstellungen konnten nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      settings: await saveSsoSettings(ctx, (await request.json()) as Record<string, unknown>),
    });
  } catch (error) {
    return apiErrorResponse(error, "SSO-Einstellungen konnten nicht gespeichert werden.");
  }
}

// Verbindung zum Identity-Provider prüfen (Discovery).
export async function POST() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await testSsoConnection(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Verbindung konnte nicht geprüft werden.");
  }
}
