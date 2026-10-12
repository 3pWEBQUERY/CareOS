import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { consumeWrite, isThrottledWrite, rateLimitKey } from "@/lib/rate-limit";
import { carecoreDb } from "@/lib/server-data";
import { pagePermissions } from "@/app/components/navigation";

// Schreibende API-Anfragen drosseln; bei einem Fehler der Zählung wird die Anfrage nicht blockiert.
async function throttleApi(request: NextRequest) {
  if (!isThrottledWrite(request.method, request.nextUrl.pathname)) return NextResponse.next();
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const result = await consumeWrite(carecoreDb(), rateLimitKey(request.cookies.get(SESSION_COOKIE)?.value, ip));
    if (!result.allowed)
      return NextResponse.json(
        { error: "Zu viele Änderungen in kurzer Zeit. Bitte einen Moment warten und erneut versuchen." },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
      );
  } catch (error) {
    console.error("Rate limit check failed", error);
  }
  return NextResponse.next();
}

// Seiten, die die Navigation einer Rolle nicht zeigt, auch beim direkten Aufruf nicht öffnen (die Daten
// schützen die APIs ohnehin); stattdessen „Kein Zugriff“ unter derselben Adresse.
async function pageAllowed(userId: string, pathname: string) {
  const needed = pagePermissions(pathname);
  if (!needed.length) return { allowed: true, strongLoginMissing: false };
  const rows = await carecoreDb()`
    SELECT carecore_access_permissions(${userId}) AS permissions,
      COALESCE(carecore_strong_login_missing(${userId}), FALSE) AS strong_login_missing`;
  const granted = Array.isArray(rows[0]?.permissions) ? (rows[0].permissions as string[]) : [];
  return {
    allowed: needed.every((permission) => granted.includes(permission)),
    strongLoginMissing: Boolean(rows[0]?.strong_login_missing),
  };
}

// „Kein Zugriff“ unter derselben Adresse; fehlt nur die Zwei-Faktor-Anmeldung (Pflicht der Einrichtung), sagt die
// Seite das und führt zur Einrichtung.
function noAccess(request: NextRequest, strongLoginMissing: boolean) {
  const target = request.nextUrl.clone();
  target.pathname = "/kein-zugriff";
  target.search = strongLoginMissing ? "?grund=zwei-faktor" : "";
  return NextResponse.rewrite(target);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return throttleApi(request);
  if (pathname === "/") return NextResponse.next();
  // Portal für Angehörige und Ärztinnen/Ärzte: eigene Anmeldung (Cookie carecore_portal), prüft die Seite selbst.
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return NextResponse.next();
  // Passwort mit dem Link aus der E-Mail setzen: ohne Anmeldung, prüft den Link selbst.
  if (pathname === "/passwort") return NextResponse.next();

  if (!pathname.startsWith("/c")) {
    const target = request.nextUrl.clone();
    target.pathname = `/c${pathname}`;
    return NextResponse.redirect(target);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  try {
    const user = await getSessionUser(token);
    if (user) {
      const access = await pageAllowed(user.id, pathname);
      return access.allowed ? NextResponse.next() : noAccess(request, access.strongLoginMissing);
    }
  } catch (error) {
    console.error("Session validation failed", error);
  }

  const login = request.nextUrl.clone();
  login.pathname = "/";
  login.search = "";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|sw.js|sw-crypto.js|manifest.webmanifest|icons/).*)",
  ],
};
