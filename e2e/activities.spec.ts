import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Alltag & Aktivierung: Angebot planen, Teilnahme erfassen und in der Monatsübersicht wiederfinden.
test("Alltag & Aktivierung: Angebot planen, Teilnahme erfassen, Übersicht", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const title = `Singnachmittag E2E ${Date.now()}`;

  // Die Administration teilt zu, wer Angebote leiten kann.
  await page.goto("/c/leitung/administration/konfiguration");
  const leadersCard = page.locator("section", { has: page.getByRole("heading", { name: "Leitung von Angeboten" }) });
  await leadersCard.getByRole("button", { name: /Festlegen|Bearbeiten/ }).click();
  const leadersDialog = page.getByRole("dialog", { name: "Leitung von Angeboten" });
  const person = leadersDialog.getByRole("group", { name: "Mitarbeitende" }).getByRole("button").first();
  const leader = ((await person.textContent()) ?? "").trim();
  if ((await person.getAttribute("aria-pressed")) !== "true") await person.click();
  await expect(person).toHaveAttribute("aria-pressed", "true");
  await leadersDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Leitung von Angeboten gespeichert")).toBeVisible();
  await expect(leadersCard.locator(".admin-retention-row", { hasText: leader })).toBeVisible();

  await page.goto("/c/alltag");
  await expect(page.getByRole("heading", { name: "Angebote", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Angebot planen" }).click();
  const dialog = page.getByRole("dialog", { name: "Angebot planen" });
  await dialog.getByLabel("Angebot", { exact: true }).fill(title);
  await dialog.getByRole("combobox", { name: "Kategorie" }).click();
  await page.getByRole("option", { name: "Musik & Singen" }).click();
  // Heute früh: bereits begonnen, damit die Teilnahme erfasst werden kann.
  await dialog.getByLabel("Uhrzeit").fill("00:00");
  await dialog.getByLabel("Ort (optional)").fill("Aufenthaltsraum");
  await dialog.getByRole("combobox", { name: "Leitung (optional)" }).click();
  await page.getByRole("option", { name: leader, exact: true }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();

  const card = page.locator(".activity-card", { hasText: title });
  await expect(card).toContainText("Musik & Singen");
  await expect(card).toContainText("Aufenthaltsraum");
  await expect(card).toContainText(leader);
  await card.getByRole("button", { name: "Teilnahme erfassen" }).click();
  const participation = page.getByRole("dialog", { name: "Teilnahme erfassen" });
  const first = participation.locator(".participation-list li").first();
  await first.getByRole("button", { name: "Teilgenommen" }).click();
  await expect(first.getByRole("button", { name: "Teilgenommen" })).toHaveAttribute("aria-pressed", "true");
  const name = (await first.locator(".participation-person strong").textContent()) ?? "";
  await first.getByRole("textbox").fill("hat mitgesungen");
  await participation.getByRole("button", { name: "Teilnahme speichern" }).click();
  await expect(card).toContainText("1 teilgenommen");

  await page.goto("/c/alltag/teilnahme");
  await expect(page.getByRole("heading", { name: "Teilnahme je Person", level: 1 })).toBeVisible();
  const row = page.locator(".participation-report tr", { hasText: name });
  await expect(row).toBeVisible();
  await expect(page.locator(".participation-report thead")).toContainText("Musik & Singen");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV exportieren" }).click();
  expect((await download).suggestedFilename()).toMatch(/^teilnahme-\d{4}-\d{2}\.csv$/);
  expect(errors).toEqual([]);
});
