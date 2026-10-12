import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Versicherung und Zimmer als Auswahl: Liste der Versicherungen in der Konfiguration ergänzen, in den Stammdaten
// Versicherung und neues Zimmer wählen, danach die Vorgabe wiederherstellen.
test("Stammdaten: Versicherung aus der Liste der Administration, Zimmerwechsel per Auswahl", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const tag = Date.now().toString().slice(-6);
  const insurer = `Hauskasse ${tag}`;

  await page.goto("/c/leitung/administration/konfiguration");
  const card = page.getByRole("region", { name: "Versicherungen", exact: true });
  await expect(card).toContainText("Versicherungen für Schweiz · Vorgabe");
  await expect(card).toContainText("Helsana");
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const setup = page.getByRole("dialog", { name: "Versicherungen für Schweiz" });
  const list = setup.getByLabel("Versicherungen");
  await list.fill(`${await list.inputValue()}\n${insurer}`);
  await setup.getByRole("button", { name: "Versicherungen speichern" }).click();
  await expect(setup).toHaveCount(0);
  await expect(card).toContainText("eigene Liste");
  await expect(card).toContainText(insurer);

  // Zwei Zimmer der Administration: Eintritt ins erste, Wechsel ins zweite.
  const units = (await (await page.request.get("/api/organization")).json()) as { units: Array<{ id: string }> };
  for (const name of [`Zimmer A${tag}`, `Zimmer B${tag}`]) {
    const room = await page.request.post("/api/occupancy/rooms", {
      data: { careUnitId: units.units[0].id, name, beds: 1 },
    });
    expect(room.status()).toBe(201);
  }
  const created = await page.request.post("/api/residents", {
    data: {
      firstName: "Rosa",
      lastName: `Wechsel${tag}`,
      careUnitId: units.units[0].id,
      room: `Zimmer A${tag}`,
      birthDate: "1937-03-09",
      admissionDate: "2026-02-02",
      careLevel: "Noch nicht eingestuft",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/c/bewohner?resident=${id}`);
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await page.getByRole("button", { name: "Stammdaten bearbeiten" }).click();
  await page.getByRole("combobox", { name: "Krankenversicherung" }).click();
  await page.getByRole("option", { name: insurer, exact: true }).click();
  await page.getByRole("combobox", { name: "Konfession" }).click();
  await page.getByRole("option", { name: "Christkatholisch", exact: true }).click();
  await page.getByRole("combobox", { name: "Zimmer" }).click();
  await expect(page.getByRole("option", { name: new RegExp(`Zimmer A${tag} · bisheriges Zimmer`) })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(`Zimmer B${tag} · 1 Bett frei`) }).click();
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.locator(".toast")).toContainText("Zimmer gewechselt");
  await expect(page.getByRole("button", { name: "Stammdaten bearbeiten" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Konfession" })).toContainText("Christkatholisch");
  const card2 = page.locator("section", { has: page.getByRole("heading", { name: "Versicherung", exact: true }) });
  await expect(card2.locator("input").first()).toHaveValue(insurer);
  await expect(page.locator("label", { hasText: "Zimmer" }).locator("input").first()).toHaveValue(`Zimmer B${tag}`);

  // Vorgabe wiederherstellen; die erfasste Versicherung bleibt in der Akte.
  await page.goto("/c/leitung/administration/konfiguration");
  await card.getByRole("button", { name: "Vorgabe wiederherstellen" }).click();
  await page
    .getByRole("dialog", { name: "Vorgabe wiederherstellen" })
    .getByRole("button", { name: "Wiederherstellen" })
    .click();
  await expect(card).toContainText("Versicherungen für Schweiz · Vorgabe");
  expect(errors).toEqual([]);
});
