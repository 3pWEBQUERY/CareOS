import { NextResponse } from "next/server";
import { sessionRedirect } from "@/lib/login-session";
import { completeSso } from "@/lib/sso";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Rückkehr vom Identity-Provider: bei Erfolg Sitzung und Weiterleitung, sonst zurück zur Anmeldung mit Grund.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const login = new URL("/", url.origin);
  try {
    const result = await completeSso(carecoreDb(), url);
    if (result.ok) return sessionRedirect(result.user, request.headers.get("user-agent"), url.origin, result.next);
    login.searchParams.set("sso", result.reason);
  } catch (error) {
    console.error("SSO callback failed", error);
    login.searchParams.set("sso", "Die Anmeldung über SSO ist derzeit nicht möglich.");
  }
  return NextResponse.redirect(login, 303);
}
