import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Datenübernahme: Vorlage, Datei mit Fehlern (nichts übernehmen), korrigierte Datei übernehmen, Person in der Liste.
test("Datenübernahme: Bewohner aus CSV prüfen und übernehmen", async ({ page }) => {
  const tag = Date.now().toString(36);
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/administration/import");
  await expect(page.getByRole("heading", { level: 1, name: "Datenübernahme" })).toBeVisible();

  // Vorlage: nur die Kopfzeile.
  const template = await page.request.get("/api/admin/import?kind=residents");
  expect(template.headers()["content-type"]).toContain("text/csv");
  expect((await template.text()).replace(/^﻿/, "").trim()).toBe(
    "Vorname;Nachname;Geburtsdatum;Geschlecht;Wohnbereich;Zimmer;Eintritt;Status;Notiz",
  );

  const units = (await (await page.request.get("/api/organization")).json()) as { units: Array<{ name: string }> };
  const unit = units.units[0].name;
  const upload = (rows: string[]) =>
    page.locator('input[type="file"]').setInputFiles({
      name: "bewohner.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        ["Vorname;Nachname;Geburtsdatum;Geschlecht;Wohnbereich;Zimmer;Eintritt;Status;Notiz", ...rows].join("\r\n"),
      ),
    });

  await upload([
    `Import${tag};Eins;12.03.1938;weiblich;${unit};301;01.09.2026;aktiv;`,
    `Import${tag};Zwei;31.02.1940;;${unit};302;01.09.2026;;`,
  ]);
  const preview = page.getByRole("region", { name: "Prüfen und übernehmen" });
  await expect(preview).toContainText("1 von 2 Zeilen in Ordnung");
  await expect(preview.getByRole("row").filter({ hasText: "Zwei" })).toContainText("Geburtsdatum ungültig");
  await expect(preview.getByRole("button", { name: "2 übernehmen" })).toBeDisabled();

  await upload([
    `Import${tag};Eins;12.03.1938;weiblich;${unit};301;01.09.2026;aktiv;`,
    `Import${tag};Zwei;28.02.1940;;${unit};302;01.09.2026;;`,
  ]);
  await expect(preview).toContainText("2 von 2 Zeilen in Ordnung");
  await preview.getByRole("button", { name: "2 übernehmen" }).click();
  await expect(page.getByRole("region", { name: "2 übernommen" })).toBeVisible();

  await page.goto("/c/bewohner");
  await expect(page.locator(".resident-list-row", { hasText: `Import${tag}` }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
