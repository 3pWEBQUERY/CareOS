import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, login, watchErrors } from "./support";

// Posteingang: Klassen als Filter und Bündelung gleichartiger Hinweise (drei fällige Aufgaben am selben Tag).
test("Benachrichtigungen: Klasse „Handlung“ zeigt fällige Aufgaben gebündelt", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const me = ((await (await page.request.get("/api/conversations")).json()) as { actor: { id: string } }).actor;
  const stamp = Date.now();
  for (const name of ["Lagerung", "Mobilisation", "Trinkprotokoll"]) {
    const response = await page.request.post("/api/tasks", {
      data: {
        title: `E2E ${name} ${stamp}`,
        category: "Pflege",
        assignedTo: me.id,
        dueAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto("/c/benachrichtigungen");
  await page.getByRole("button", { name: /^Handlung/ }).click();
  const bundle = page.locator(".notifications-bundle", { hasText: "Aufgabe fällig" }).first();
  await expect(bundle.locator(".notifications-page-category")).toHaveText("Handlung nötig · gebündelt");
  await expect(bundle.locator("strong").first()).toHaveText(/^\d+ × Aufgabe fällig$/);
  await bundle.locator(".notifications-page-row").first().click();
  await expect(bundle.locator(".notifications-bundle-items")).toContainText(`E2E Mobilisation ${stamp}`);
  await bundle.getByRole("button", { name: /als gelesen markieren/ }).click();
  await expect(page.locator(".toast")).toContainText("als gelesen markiert");
  await expect(bundle.locator(".notification-unread")).toHaveCount(0);

  // Eine Direktnachricht ist „Sozial“, nicht „Handlung“.
  await page.getByRole("button", { name: /^Sozial/ }).click();
  await expect(page.locator(".notifications-page-row", { hasText: "Aufgabe fällig" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Echtzeit: Eine neue Benachrichtigung erscheint ohne Neuladen (Server-Sent Events statt Warten auf das Nachladen).
test("Echtzeit: neue Benachrichtigung erscheint ohne Neuladen", async ({ page, browser }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  expect((await page.request.patch("/api/notifications", { data: { all: true } })).status()).toBe(200);
  const live = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/events");
  await page.goto("/c");
  await live;
  await expect(page.locator(".notification-trigger .notification-dot").first()).toHaveCount(0);

  const other = await browser.newContext();
  const reporter = await other.newPage();
  await login(reporter, FAGE);
  expect(
    (
      await reporter.request.post("/api/quality/events", {
        data: {
          type: "Beschwerde",
          severity: "attention",
          title: `E2E Echtzeit ${Date.now()}`,
          description: "Echtzeit-Klicktest",
          occurredAt: new Date().toISOString(),
        },
      })
    ).status(),
  ).toBe(201);
  await other.close();
  await expect(page.locator(".notification-trigger .notification-dot").first()).toBeVisible({ timeout: 25_000 });
  expect(errors).toEqual([]);
});
