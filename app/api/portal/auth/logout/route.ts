import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PORTAL_COOKIE, deletePortalSession } from "@/lib/portal";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

export async function POST() {
  await deletePortalSession(carecoreDb(), (await cookies()).get(PORTAL_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(PORTAL_COOKIE);
  return response;
}
