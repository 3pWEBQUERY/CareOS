import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Rückmeldungen: Frist festlegen, Beschwerde erfassen, beantworten, abschliessen, Auswertung.
test("Rückmeldungen: Frist, Beschwerde erfassen, beantworten, abschliessen, Auswertung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const topic = `Wäsche ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/leitung/qualitaet/rueckmeldungen");
  await expect(page.getByRole("heading", { name: "Rückmeldungen & Beschwerden", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /^Antwortfrist/ }).click();
  const days = page.getByRole("dialog", { name: "Antwortfrist der Einrichtung" });
  await days.getByLabel("Antwortfrist (Tage)").fill("14");
  await days.getByRole("button", { name: "Frist speichern" }).click();
  await expect(days).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Antwortfrist: 14 Tage" })).toBeVisible();

  await page.getByRole("button", { name: "Rückmeldung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Rückmeldung erfassen" });
  await dialog.getByRole("button", { name: "Beschwerde" }).click();
  await dialog.getByRole("button", { name: "Angehörige" }).click();
  await dialog.getByRole("button", { name: "Telefon" }).click();
  await dialog.getByLabel("Name").fill("Frau Muster (Tochter)");
  await dialog.getByLabel("Thema").fill(topic);
  await dialog.getByLabel("Rückmeldung", { exact: true }).fill("Pullover kam verfilzt zurück.");
  await dialog.getByRole("button", { name: "Rückmeldung speichern" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole("listitem").filter({ hasText: topic });
  await expect(row).toContainText("Angehörige: Frau Muster (Tochter) · Telefon");
  await expect(row).toContainText("Offen · Frist bis");
  await row.getByRole("button", { name: `${topic}: Antwort festhalten` }).click();
  const answer = page.getByRole("dialog", { name: "Antwort festhalten" });
  await answer.getByLabel("Antwort", { exact: true }).fill("Telefonisch entschuldigt, Ersatz angeboten.");
  await answer.getByRole("button", { name: "Antwort speichern" }).click();
  await expect(answer).toHaveCount(0);
  await expect(row).toContainText("Beantwortet");
  await row.getByRole("button", { name: `${topic} abschliessen` }).click();
  await expect(row).toContainText("Abgeschlossen");

  const evaluation = page.getByRole("region", { name: "Auswertung für das Qualitätsmanagement" });
  await expect(evaluation.getByRole("row", { name: new RegExp(topic) })).toContainText("1");
  expect(errors).toEqual([]);
});
