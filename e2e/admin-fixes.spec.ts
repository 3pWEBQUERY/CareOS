import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Teamleitung: Aufgabenboard zeigt die Aufgaben; Ersteinrichtung: „Öffnen“ führt zum passenden Dialog bzw. zur
// Karte und der Schritt wird ohne Neuladen abgehakt.

test("Teamleitung › Aufgaben: erstellte Aufgabe erscheint im Aufgabenboard", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const title = `Pflegestandard Sturz prüfen ${Date.now()}`;
  const created = await page.request.post("/api/teamlead/tasks", { data: { title, priority: "high" } });
  expect(created.status()).toBe(201);
  await page.goto("/c/leitung/teamleitung/aufgaben");
  const card = page.locator(".teamlead-task-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Hoch");
  // Nur Aufgaben, keine Personen: jede Karte hat einen Titel.
  for (const heading of await page.locator(".teamlead-task-card strong").allTextContents())
    expect(heading.trim()).not.toBe("");
  await card.getByRole("button", { name: "Archivieren" }).click();
  await expect(
    page.locator(".teamlead-task-column").last().locator(".teamlead-task-card").filter({ hasText: title }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Ersteinrichtung: Standort über „Öffnen“ ergänzen und Land bestätigen – Schritte werden abgehakt", async ({
  page,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/administration");
  const checklist = page.locator(".setup-checklist");
  const step = (label: string) => checklist.locator("li").filter({ hasText: label });
  await expect(step("Standort mit Adresse")).toBeVisible();

  const site = step("Standort mit Adresse");
  if (await site.getByText("– offen").count()) {
    await site.getByRole("button", { name: "Öffnen" }).click();
    const dialog = page.getByRole("dialog", { name: "Standort bearbeiten" });
    await dialog.getByLabel("Adresse").fill("Lindenweg 4");
    await dialog.getByLabel("PLZ und Ort").fill("8400 Winterthur");
    await dialog.getByRole("button", { name: /speichern/i }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(step("Standort mit Adresse")).toContainText("– erledigt");

  const country = step("Land der Einrichtung");
  if (await country.getByText("– offen").count()) {
    await country.getByRole("link", { name: "Öffnen" }).click();
    await expect(page).toHaveURL(/konfiguration#land$/);
    const card = page.locator("#land");
    await expect(card).toBeInViewport();
    await card.getByRole("button", { name: "Schweiz" }).click();
    await expect(card.getByText("Noch nicht bestätigt")).toHaveCount(0);
    await page.goto("/c/leitung/administration");
  }
  await expect(step("Land der Einrichtung")).toContainText("– erledigt");
  expect(errors).toEqual([]);
});
