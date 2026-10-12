import { expect, test } from "@playwright/test";
import { ADMIN, login, waitForNetworkIdle } from "./support";

// Offline-Betrieb mit Service Worker: die Seite öffnet sich ohne Verbindung, ein Eintrag wird auf dem Gerät
// vorgemerkt und nach der Rückkehr der Verbindung genau einmal gespeichert.
test("Offline: Dokumentation wird vorgemerkt und nach der Rückkehr der Verbindung gesendet", async ({
  page,
  context,
}) => {
  await login(page, ADMIN);
  await page.goto("/c/pflegedokumentation");
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
  );
  // Mit aktivem Service Worker neu laden: Seite und Daten liegen danach im Gerätespeicher.
  await page.reload();
  await expect(page.locator("h1").first()).toBeVisible();
  const form = page.locator("form", { has: page.locator("textarea") }).first();
  await expect(form.locator("button.primary-button")).toBeEnabled();
  await waitForNetworkIdle(page);

  const text = `Offline-Eintrag ${Date.now()}`;
  await context.setOffline(true);
  await form.locator("textarea").fill(text);
  await form.locator("button.primary-button").click();
  await expect(page.locator(".toast")).toContainText("Offline gespeichert");
  await expect(page.locator(".offline-status")).toContainText("1 Eintrag wartet");

  // Vor dem Senden korrigieren.
  const corrected = `${text} (korrigiert)`;
  await page.locator(".offline-status").getByRole("button", { name: "Anzeigen" }).click();
  await page.locator(".offline-status").getByRole("button", { name: "Bearbeiten" }).click();
  await page.locator(".offline-status-edit textarea").fill(corrected);
  await page.locator(".offline-status-edit").getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".offline-status-edit")).toHaveCount(0);

  // Im Gerätespeicher liegt der Eintrag nur verschlüsselt.
  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("carecore-offline");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction("outbox").objectStore("outbox").getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(stored).toContain('"sealed"');
  expect(stored).not.toContain("Offline-Eintrag");

  // Neu laden ohne Verbindung: die Seite kommt aus dem Gerätespeicher. Der Schlüssel lag nur im Arbeitsspeicher –
  // der Eintrag ist jetzt gesperrt (nicht lesbar), bis die Verbindung zurück ist.
  await page.reload();
  await expect(page.locator("h1").first()).toContainText("Schnelldokumentation");
  await expect(page.locator(".offline-status")).toContainText("Offline");
  await expect(page.locator(".offline-status")).toContainText("1 Eintrag wartet");
  await page.locator(".offline-status").getByRole("button", { name: "Anzeigen" }).click();
  await expect(page.locator(".offline-status-list")).toContainText("Verschlüsselter Eintrag");
  await expect(page.locator(".offline-status-list")).not.toContainText("Offline-Eintrag");
  await expect(page.locator(".offline-status").getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".offline-status")).toContainText(/offline erfasste(r Eintrag| Einträge) gesendet/, {
    timeout: 20_000,
  });

  const response = await page.request.get("/api/documentation?days=1");
  const payload = (await response.json()) as { entries: Array<{ body: string }> };
  expect(payload.entries.filter((entry) => entry.body === corrected)).toHaveLength(1);
  expect(payload.entries.filter((entry) => entry.body === text)).toHaveLength(0);
});

test("Meine Notizen: archivieren und wiederherstellen, auch ohne Verbindung", async ({ page, context }) => {
  await login(page, ADMIN);
  await page.goto("/c");
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
  );
  await page.reload();
  const card = page.locator(".home-notes");
  await expect(card.locator("h2")).toHaveText("Meine Notizen");
  await waitForNetworkIdle(page);
  const stamp = Date.now();
  const archivedTitle = `Archiv-Test ${stamp}`;
  const offlineTitle = `Offline-Notiz ${stamp}`;
  const dialog = page.locator(".home-note-panel");

  // Online: Notiz anlegen und ins Archiv verschieben.
  await card.getByRole("button", { name: "Notiz erstellen", exact: true }).click();
  await dialog.getByLabel("Titel").fill(archivedTitle);
  await dialog.getByLabel("Notiz").fill("Wird gleich archiviert");
  await dialog.getByRole("button", { name: "Notiz speichern" }).click();
  await card.getByRole("button", { name: new RegExp(archivedTitle) }).click();
  await dialog.getByRole("button", { name: "Archivieren" }).click();
  await expect(card.getByRole("button", { name: new RegExp(archivedTitle) })).toHaveCount(0);
  await card.getByRole("button", { name: /^Archiv \(\d+\)$/ }).click();
  await expect(card.locator("h2")).toHaveText("Archivierte Notizen");
  await expect(card.getByRole("button", { name: new RegExp(archivedTitle) })).toBeVisible();

  // Offline: archivierte Notiz wiederherstellen und eine neue anlegen.
  await context.setOffline(true);
  await card.getByRole("button", { name: new RegExp(archivedTitle) }).click();
  await dialog.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.locator(".toast")).toContainText("offline vorgemerkt");
  await card.getByRole("button", { name: "Aktuelle" }).click();
  await expect(card.getByRole("button", { name: new RegExp(archivedTitle) })).toContainText("Nicht gesendet");
  await card.getByRole("button", { name: "Notiz erstellen", exact: true }).click();
  await dialog.getByLabel("Titel").fill(offlineTitle);
  await dialog.getByLabel("Notiz").fill("Ohne Verbindung erfasst");
  await dialog.getByRole("button", { name: "Notiz speichern" }).click();
  await expect(card.getByRole("button", { name: new RegExp(offlineTitle) })).toContainText("Nicht gesendet");
  await expect(page.locator(".offline-status")).toContainText("2 Einträge warten");

  // Neu laden ohne Verbindung: die Änderungen bleiben vorgemerkt, aber verschlüsselt und bis zur Verbindung
  // gesperrt (Schlüssel nur im Arbeitsspeicher) – sie erscheinen erst danach wieder in der Liste.
  await page.reload();
  await expect(page.locator(".offline-status")).toContainText("2 Einträge warten");
  await expect(card.getByRole("button", { name: new RegExp(offlineTitle) })).toHaveCount(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".offline-status")).toContainText(/offline erfasste(r Eintrag| Einträge) gesendet/, {
    timeout: 20_000,
  });
  const saved = (await (await page.request.get("/api/dashboard/notes")).json()) as {
    notes: Array<{ title: string; archived_at: string | null }>;
  };
  expect(saved.notes.filter((note) => note.title === offlineTitle)).toHaveLength(1);
  expect(saved.notes.find((note) => note.title === archivedTitle)?.archived_at).toBeNull();
});

test("Meine Notizen: offline bearbeitet, inzwischen anderswo geändert – Konflikt, eigene Fassung übernehmen", async ({
  page,
  context,
}) => {
  await login(page, ADMIN);
  const title = `Konflikt-Test ${Date.now()}`;
  const id = crypto.randomUUID();
  const created = await page.request.post("/api/dashboard/notes", {
    data: { id, title, body: "Stand A", pinned: false },
  });
  expect(created.ok()).toBe(true);
  await page.goto("/c");
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
  );
  await page.reload();
  const card = page.locator(".home-notes");
  await expect(card.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await waitForNetworkIdle(page);

  // Ein anderes Gerät ändert die Notiz, während dieses Gerät noch den alten Stand zeigt.
  const other = await page.request.patch("/api/dashboard/notes", {
    data: { id, title, body: "Stand vom anderen Gerät", pinned: false },
  });
  expect(other.ok()).toBe(true);

  await context.setOffline(true);
  await card.getByRole("button", { name: new RegExp(title) }).click();
  await page
    .locator(".home-note-panel")
    .getByRole("button", { name: /Bearbeiten/ })
    .click();
  const dialog = page.locator(".home-note-panel");
  await dialog.getByLabel("Notiz").fill("Meine Fassung");
  await dialog.getByRole("button", { name: "Notiz speichern" }).click();
  await expect(page.locator(".toast")).toContainText("offline vorgemerkt");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const status = page.locator(".offline-status");
  await expect(status).toContainText("abgelehnt", { timeout: 20_000 });
  await status.getByRole("button", { name: "Anzeigen" }).click();
  await expect(status).toContainText("Konflikt: Die Notiz wurde inzwischen auf einem anderen Gerät geändert.");
  await status.getByRole("button", { name: "Meine Fassung übernehmen" }).click();
  await expect(status).toContainText(/offline erfasste(r Eintrag| Einträge) gesendet/, { timeout: 20_000 });

  const saved = (await (await page.request.get("/api/dashboard/notes")).json()) as {
    notes: Array<{ id: string; body: string }>;
  };
  expect(saved.notes.find((note) => note.id === id)?.body).toBe("Meine Fassung");
});

test("Offline-Daten: nur verschlüsselt gespeichert; ohne Verbindung mit dem Passwort entsperrt, beim Abmelden gelöscht", async ({
  page,
  context,
}) => {
  // Anmeldung über das Formular: dabei wird der Schlüssel mit dem Passwort verschlüsselt auf dem Gerät abgelegt.
  await page.goto("/");
  await page.getByLabel("Benutzername").fill(ADMIN.username);
  await page.getByLabel("Passwort", { exact: true }).fill(ADMIN.password);
  await page.locator(".login-submit").click();
  await page.waitForURL(/\/c/);
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith("carecore.offline.unlock.")));
  await page.goto("/c/pflegedokumentation");
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
  );
  await page.reload();
  const form = page.locator("form", { has: page.locator("textarea") }).first();
  await expect(form.locator("button.primary-button")).toBeEnabled();
  await waitForNetworkIdle(page);

  // Im Zwischenspeicher liegen Daten nur verschlüsselt.
  const name = ((await (await page.request.get("/api/work-context")).json()) as { profile: { displayName: string } })
    .profile.displayName;
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("carecore-data-v2");
    return Promise.all((await cache.keys()).map(async (request) => (await cache.match(request))!.text()));
  });
  expect(cached.length).toBeGreaterThan(0);
  for (const body of cached) {
    expect(JSON.parse(body)).toMatchObject({ v: 1, epk: { crv: "P-256" } });
    expect(body).not.toContain(name);
  }

  // Ohne Verbindung erfassen, neu laden: der Eintrag ist gesperrt. Falsches Passwort abgelehnt, richtiges entsperrt.
  const text = `Entsperr-Test ${Date.now()}`;
  await context.setOffline(true);
  await form.locator("textarea").fill(text);
  await form.locator("button.primary-button").click();
  await expect(page.locator(".toast")).toContainText("Offline gespeichert");
  await page.reload();
  const status = page.locator(".offline-status");
  await expect(status).toContainText("1 Eintrag wartet");
  await status.getByRole("button", { name: "Entsperren" }).click();
  await status.getByLabel("Passwort (ohne Verbindung entsperren)").fill("falsch");
  await status.locator("form").getByRole("button", { name: "Entsperren" }).click();
  await expect(status).toContainText("Das Passwort stimmt nicht.");
  await status.getByLabel("Passwort (ohne Verbindung entsperren)").fill(ADMIN.password);
  await status.locator("form").getByRole("button", { name: "Entsperren" }).click();
  await expect(status.locator("form")).toHaveCount(0);
  await status.getByRole("button", { name: "Anzeigen" }).click();
  await expect(status.locator(".offline-status-list")).toContainText("wartet auf Verbindung");
  await status.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(status.locator(".offline-status-edit textarea")).toHaveValue(text);
  await status.locator(".offline-status-edit").getByRole("button", { name: "Abbrechen" }).click();

  // Mit Verbindung gesendet; Abmelden löscht den verpackten Schlüssel vom Gerät.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(status).toContainText(/offline erfasste(r Eintrag| Einträge) gesendet/, { timeout: 20_000 });
  await page.locator(".profile-trigger").first().click();
  await page.getByRole("menuitem", { name: "Ausloggen" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("carecore.offline.unlock."))),
  ).toEqual([]);
});

test("Manifest und Service Worker sind erreichbar (installierbar)", async ({ page }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(((await manifest.json()) as { start_url: string }).start_url).toBe("/c");
  const worker = await page.request.get("/sw.js", { maxRedirects: 0 });
  expect(worker.status()).toBe(200);
  expect(worker.headers()["cache-control"]).toContain("no-cache");
});
