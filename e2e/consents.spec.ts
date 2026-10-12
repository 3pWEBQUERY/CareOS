import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Einwilligungen: Themen in der Konfiguration, Entscheid in der Akte, Stand in der Übersicht, Widerruf.
test("Einwilligungen: Themen festlegen, Ablehnung erfassen, Übersicht, Zustimmung widerrufen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const topic = `Fotos ${Date.now().toString().slice(-5)}`;

  await page.goto("/c/leitung/administration/konfiguration");
  const card = page.getByRole("region", { name: "Themen der Einwilligungen" });
  await card.getByRole("button", { name: /Festlegen|Bearbeiten/ }).click();
  const setup = page.getByRole("dialog", { name: "Themen der Einwilligungen" });
  await setup.getByLabel("Themen").fill(`${topic}\nWeitergabe an Angehörige`);
  await setup.getByRole("button", { name: "Themen speichern" }).click();
  await expect(setup).toHaveCount(0);

  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const consents = page.getByRole("region", { name: "Einwilligungen & Freigaben" });
  const row = consents.getByRole("list", { name: "Stand je Thema" }).locator("li", { hasText: topic });
  await expect(row).toContainText("Nicht erfasst");
  await row.getByRole("button", { name: `${topic}: Entscheid erfassen` }).click();
  const dialog = page.getByRole("dialog", { name: "Entscheid erfassen" });
  await expect(dialog.getByLabel("Thema")).toHaveValue(topic);
  await dialog.getByRole("button", { name: "Abgelehnt" }).click();
  await dialog.getByLabel("Entschieden von").fill("Tochter (Vertretung)");
  await dialog.getByRole("button", { name: "Entscheid speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText("Abgelehnt");
  await expect(row).toContainText("Tochter (Vertretung)");

  const sharing = consents
    .getByRole("list", { name: "Stand je Thema" })
    .locator("li", { hasText: "Weitergabe an Angehörige" });
  await sharing.getByRole("button", { name: "Weitergabe an Angehörige: Entscheid erfassen" }).click();
  await dialog.getByRole("button", { name: "Zugestimmt" }).click();
  await dialog.getByLabel("Entschieden von").fill("die Person selbst");
  await dialog.getByRole("button", { name: "Entscheid speichern" }).click();
  await expect(sharing).toContainText("Zugestimmt");
  await sharing.getByRole("button", { name: "Weitergabe an Angehörige widerrufen" }).click();
  const revoke = page.getByRole("dialog", { name: "Einwilligung widerrufen" });
  await revoke.getByRole("button", { name: "Widerruf speichern" }).click();
  await expect(revoke).toHaveCount(0);
  await expect(sharing).toContainText("Widerrufen");

  await page.goto("/c/bewohner/einwilligungen");
  await expect(page.getByRole("heading", { name: "Einwilligungen", level: 1 })).toBeVisible();
  await page.getByRole("group", { name: "Thema" }).getByRole("button", { name: topic }).click();
  await expect(page.locator(".consent-row.refused")).toHaveCount(1);
  await expect(page.locator(".consent-row.refused")).toContainText("Abgelehnt");
  expect(errors).toEqual([]);
});
