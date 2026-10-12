import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Visite vorbereiten: Frage „Für Visite“ erscheint je Hausarzt, steht auf der Visitenliste und wird mit der
// Rückmeldung erledigt.
test("Visite: offene Frage sehen, drucken und Rückmeldung erfassen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  const resident = residents[0];
  const question = `Bitte Schlafmedikation besprechen ${Date.now()}`;
  const created = await page.request.post("/api/documentation", {
    data: { residentId: resident.id, category: "Beobachtung", body: question, importance: "visit" },
  });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto("/c/pflegedokumentation/visite");
  await expect(page.getByRole("heading", { name: "Visite vorbereiten", level: 1 })).toBeVisible();
  const item = page.locator(".visit-resident li", { hasText: question });
  await expect(item).toBeVisible();
  await expect(page.locator(".visit-resident", { has: page.locator("li", { hasText: question }) })).toContainText(
    resident.name,
  );

  await page.goto("/c/pflegedokumentation/visite/drucken?dialog=0");
  await expect(page.locator(".visit-sheet")).toContainText(question);

  await page.goto("/c/pflegedokumentation/visite");
  await item.getByRole("button", { name: "Rückmeldung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Rückmeldung erfassen" });
  await expect(dialog).toContainText(question);
  await dialog.getByLabel("Rückmeldung").fill("Abendmedikation bleibt, Kontrolle in zwei Wochen");
  await dialog.getByRole("button", { name: "Rückmeldung speichern" }).click();
  await expect(item).toHaveCount(0);
  const resolved = page.getByRole("region", { name: "Rückmeldungen der letzten 14 Tage" });
  await expect(resolved).toContainText(question);
  await expect(resolved).toContainText("Abendmedikation bleibt, Kontrolle in zwei Wochen");
  expect(errors).toEqual([]);
});
