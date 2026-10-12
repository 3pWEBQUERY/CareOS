import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-context";
import { startSso } from "@/lib/sso";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// ?provider=<Einrichtung>&next=/c/… → Weiterleitung zum Identity-Provider.
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const target = await startSso(
      carecoreDb(),
      url.searchParams.get("provider"),
      url.origin,
      url.searchParams.get("next"),
    );
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const reason = error instanceof ApiError ? error.message : "Der Identity-Provider ist nicht erreichbar.";
    if (!(error instanceof ApiError)) console.error("SSO start failed", error);
    const login = new URL("/", url.origin);
    login.searchParams.set("sso", reason);
    return NextResponse.redirect(login, 303);
  }
}
