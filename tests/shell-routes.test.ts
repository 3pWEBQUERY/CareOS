import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isFramedRoute, PLAIN_ROUTES } from "../app/components/shell-routes.ts";

// Der feste Rahmen (app-frame) umgibt genau die Seiten, die ModulePageShell nutzen; Druck- und Vollbildansichten
// bleiben ohne. Sonst stünde eine Seite doppelt oder gar nicht im Rahmen.

const root = process.cwd();
const app = join(root, "app");

function pages(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "api") pages(path, found);
    } else if (name === "page.tsx") found.push(path);
  }
  return found;
}

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/")
    ? join(root, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base || base.startsWith(join(root, "lib"))) return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"])
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}

// Nutzt die Seite (über ihre eigenen Bausteine) ModulePageShell?
function usesShell(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file) || file.endsWith("module-page-shell.tsx")) return false;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  if (/["'][^"']*module-page-shell["']/.test(source)) return true;
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const next = resolveImport(file, match[1]);
    if (next && usesShell(next, seen)) return true;
  }
  return false;
}

const isRedirect = (file: string) => /\bredirect\(/.test(readFileSync(file, "utf8"));

// Druckansicht: Die Seite selbst oder ein direkt eingebundener Baustein öffnet den Druckdialog. Solche Seiten stehen
// immer ohne Rahmen, auch wenn sie Hilfsfunktionen aus einer Datei mit Rahmen übernehmen.
function isPrintPage(file: string) {
  const source = readFileSync(file, "utf8");
  if (/window\.print\(/.test(source)) return true;
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].some((match) => {
    const next = resolveImport(file, match[1]);
    return Boolean(
      next &&
      /window\.print\(/.test(readFileSync(next, "utf8")) &&
      !/module-page-shell/.test(readFileSync(next, "utf8")),
    );
  });
}

test("Rahmen: alle Seiten unter /c mit ModulePageShell stehen im festen Rahmen, Druckansichten nicht", () => {
  const mismatches: string[] = [];
  let framed = 0;
  for (const file of pages(app)) {
    if (isRedirect(file)) continue;
    const route =
      file
        .slice(app.length)
        .replace(/\/page\.tsx$/, "")
        .replace(/\[[^\]]+\]/g, "beispiel") || "/";
    // Öffentliche Seiten (Anmeldung, Portal, Passwort) liegen nicht unter /c und stehen ohne Rahmen.
    if (["/", "/portal", "/passwort"].includes(route)) {
      assert.equal(usesShell(file), false, `${route} braucht keinen Rahmen`);
      assert.equal(isFramedRoute(route), false, route);
      continue;
    }
    const address = route === "/c" ? "/c" : `/c${route}`;
    // Server (ohne /c, wegen der Umschreibung) und Browser (mit /c) entscheiden gleich.
    if (route !== "/c" && isFramedRoute(route) !== isFramedRoute(address))
      mismatches.push(`${route}: Server ≠ Browser`);
    // „Kein Zugriff“ ist eine Hinweisseite im Rahmen (der Proxy zeigt sie unter der aufgerufenen Adresse).
    if (route === "/kein-zugriff") {
      assert.equal(isFramedRoute(address), true);
      continue;
    }
    const shell = !isPrintPage(file) && usesShell(file);
    if (shell) framed += 1;
    if (shell !== isFramedRoute(address)) mismatches.push(`${address}: Seite ${shell ? "mit" : "ohne"} Rahmen`);
  }
  assert.deepEqual(mismatches, []);
  assert.ok(framed > 100, "zu wenige Seiten im Rahmen gefunden");
});

test("Rahmen: Adressen ausserhalb von /c und Druckansichten ohne Rahmen", () => {
  assert.equal(isFramedRoute("/"), false);
  assert.equal(isFramedRoute("/portal"), false);
  assert.equal(isFramedRoute("/c"), true);
  assert.equal(isFramedRoute("/c/"), true);
  assert.equal(isFramedRoute("/c/bewohner"), true);
  // Umgeschriebene Adresse auf dem Server.
  assert.equal(isFramedRoute("/einstellungen"), true);
  assert.equal(isFramedRoute("/portal/visite"), false);
  for (const route of PLAIN_ROUTES) assert.equal(isFramedRoute(`/c${route}`), false, route);
});
