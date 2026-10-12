import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Durchführungsnachweis nach Abweichungen: Tageszeiten in der Pflegeplanung festlegen, Abweichung mit Grund
// erfassen, Nachweis stornieren und die übrigen Massnahmen mit einem Klick als wie geplant bestätigen.
test("Nachweis: Massnahmen je Tageszeit, Abweichung mit Grund, Storno und „Übrige wie geplant“", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const walk = `Gehtraining ${stamp}`;
  const wash = `Körperpflege ${stamp}`;

  // Zwei Massnahmen für alle Tageszeiten planen (so ist die aktuelle Tageszeit immer dabei).
  await page.goto("/c/pflegeplanung/ziele-massnahmen");
  await expect(page.getByRole("heading", { name: "Ziele & Massnahmen", level: 1 })).toBeVisible();
  const goal = page.locator("article").filter({ has: page.getByRole("link", { name: "Maria Keller" }) });
  for (const title of [walk, wash]) {
    await goal.getByRole("button", { name: "Massnahme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Massnahme planen" });
    await dialog.getByLabel("Massnahme", { exact: true }).fill(title);
    await dialog.getByLabel("Häufigkeit").fill("4× täglich");
    const parts = dialog.getByRole("group", { name: "Nachweis je Tageszeit" });
    await expect(parts).toContainText("ohne Nachweis je Tageszeit");
    for (const part of ["Morgen", "Mittag", "Abend", "Nacht"]) {
      await parts.getByRole("button", { name: part }).click();
      await expect(parts.getByRole("button", { name: part })).toHaveAttribute("aria-pressed", "true");
    }
    await dialog.getByRole("button", { name: "Massnahme speichern" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(goal.getByRole("region", { name: "Massnahmen" })).toContainText(
    "Nachweis: Morgen, Mittag, Abend, Nacht",
  );

  await page.goto("/c/pflegedokumentation/nachweis");
  await expect(page.getByRole("heading", { name: "Durchführungsnachweis", level: 1 })).toBeVisible();
  const card = page.getByRole("region", { name: "Maria Keller" });
  const row = (title: string) => card.locator("li", { hasText: title });
  await expect(row(walk)).toContainText("Offen");
  await expect(row(wash)).toContainText("Offen");

  // Abweichung mit Beschreibung; die andere Massnahme gilt als wie geplant.
  await card.getByRole("button", { name: "Abweichung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Abweichungen erfassen" });
  await dialog
    .getByRole("group", { name: `Durchführung: ${walk}` })
    .getByRole("button", { name: "Teilweise" })
    .click();
  // Ohne Beschreibung lässt sich nicht speichern (Pflichtfeld).
  const reason = dialog.getByLabel("Was wurde durchgeführt, was nicht?");
  await dialog.getByRole("button", { name: "Nachweis mit Abweichungen speichern" }).click();
  await expect(dialog).toBeVisible();
  expect(await reason.evaluate((field: HTMLTextAreaElement) => field.validity.valueMissing)).toBe(true);
  await reason.fill("Nur bis zum Flur, danach erschöpft");
  await dialog.getByRole("button", { name: "Nachweis mit Abweichungen speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(walk)).toContainText("Teilweise");
  await expect(row(walk)).toContainText("Nur bis zum Flur, danach erschöpft");
  await expect(row(wash)).toContainText("Wie geplant");

  // Storno: die Massnahme ist wieder offen und lässt sich mit „Übrige wie geplant“ bestätigen.
  await row(wash)
    .getByRole("button", { name: `Nachweis stornieren: ${wash}` })
    .click();
  const cancel = page.getByRole("dialog", { name: "Nachweis stornieren" });
  await cancel.getByLabel("Grund").fill("Falsche Tageszeit");
  await cancel.getByRole("button", { name: "Nachweis stornieren" }).click();
  await expect(row(wash)).toContainText("Offen");
  await card.getByRole("button", { name: "Übrige wie geplant" }).click();
  await expect(row(wash)).toContainText("Wie geplant");
  await expect(card.getByRole("button", { name: /wie geplant|Abweichung erfassen/ })).toHaveCount(0);

  // Die Abweichung steht als wichtiger Eintrag im Verlauf der Pflegedokumentation.
  await page.goto("/c/pflegedokumentation/verlauf");
  await expect(page.getByText(/Massnahme teilweise \(.+\): Nur bis zum Flur, danach erschöpft/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
