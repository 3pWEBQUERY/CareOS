// Welche Adressen im festen Arbeitsplatz-Rahmen (Seitenleiste, Kopfzeile, Reiter, mobile Navigation) erscheinen:
// alle Seiten des Arbeitsplatzes (/c/…) ausser Druck- und Vollbildansichten. Der Rahmen bleibt beim Seitenwechsel
// stehen, nur der Inhalt wechselt. tests/shell-routes.test.ts prüft, dass die Liste zu den Seiten passt.
//
// Server und Browser müssen gleich entscheiden: Der Server sieht wegen der Umschreibung /c/:pfad → /:pfad (und
// „Kein Zugriff“ unter derselben Adresse) die Adresse ohne /c, der Browser mit. Ohne /c erreichbar sind sonst nur
// die öffentlichen Seiten (Anmeldung, Portal, Passwort); alles andere leitet der Proxy auf /c um.

// Druck- und Vollbildansichten ohne Rahmen (Adresse ohne /c).
export const PLAIN_ROUTES = [
  "/bewohner/abrechnung/rechnung",
  "/bewohner/auskunft",
  "/bewohner/belegung/etiketten",
  "/bewohner/belegung/evakuierung",
  "/bewohner/gelder/drucken",
  "/bewohner/inventar",
  "/bewohner/ueberleitung",
  "/carecore-one/kalender/fahrdienst/druck",
  "/dienstplan/drucken",
  "/ernaehrung/kuechenliste",
  "/kompass/bericht",
  "/medikation/btm/buch",
  "/mein-dienstplan/team/drucken",
  "/pflegedokumentation/visite/drucken",
] as const;

const plain = new Set<string>(PLAIN_ROUTES);

// Öffentliche Seiten ohne Anmeldung und ohne Rahmen.
const PUBLIC = ["/portal", "/passwort"];

export function isFramedRoute(pathname: string | null) {
  // „/“ ist die Anmeldung, „/c“ die Startseite (eigene Seite, nicht umgeschrieben).
  if (!pathname || pathname === "/") return false;
  const path = (pathname.replace(/^\/c(?=\/|$)/, "") || "/").replace(/(.)\/$/, "$1");
  if (PUBLIC.some((route) => path === route || path.startsWith(`${route}/`))) return false;
  return !plain.has(path);
}
