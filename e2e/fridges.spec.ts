import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Kühlschrank-Temperatur: Kühlschrank mit Grenzen der Einrichtung erfassen, Messung innerhalb und ausserhalb.
test("Kühlschrank-Temperatur: erfassen, fällig, Messung, ausserhalb der Grenzen mit Massnahme", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Medikamentenkühlschrank ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/medikation/kuehlschrank");
  await expect(page.getByRole("heading", { name: "Kühlschrank-Temperatur", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Kühlschrank erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Kühlschrank erfassen" });
  await dialog.getByLabel("Kühlschrank", { exact: true }).fill(name);
  await dialog.getByLabel("Standort").fill("Stationszimmer");
  await dialog.getByLabel("Untere Grenze (°C)").fill("2");
  await dialog.getByLabel("Obere Grenze (°C)").fill("8");
  await dialog.getByLabel("Messrhythmus (Stunden)").fill("24");
  await dialog.getByRole("button", { name: "Kühlschrank speichern" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole("listitem", { name });
  await expect(row).toContainText("Grenzen 2.0 bis 8.0 °C");
  await expect(row).toContainText("Messung fällig · noch keine Messung");

  await row.getByRole("button", { name: `${name}: Messung erfassen` }).click();
  let reading = page.getByRole("dialog", { name: "Messung erfassen" });
  await expect(reading).toContainText("Grenzen der Einrichtung: 2.0 bis 8.0 °C.");
  await reading.getByLabel("Temperatur (°C)").fill("5,5");
  await reading.getByRole("button", { name: "Messung speichern" }).click();
  await expect(reading).toHaveCount(0);
  await expect(row).toContainText("5.5 °C");
  await expect(row).toContainText("Zuletzt gemessen");

  await row.getByRole("button", { name: `${name}: Messung erfassen` }).click();
  reading = page.getByRole("dialog", { name: "Messung erfassen" });
  await reading.getByLabel("Temperatur (°C)").fill("9,2");
  await expect(reading.getByRole("alert")).toContainText("ausserhalb der Grenzen der Einrichtung");
  await reading.getByLabel("Massnahme").fill("Tür offen, erneut gemessen");
  await reading.getByRole("button", { name: "Messung speichern" }).click();
  await expect(reading).toHaveCount(0);
  await expect(row).toContainText("Ausserhalb der Grenzen · Massnahme: Tür offen, erneut gemessen");
  expect(errors).toEqual([]);
});
