import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// eMediplan: Code einlesen, Abweichung zur Person sehen, Zeile prüfen und als zwei Verordnungen übernehmen.
test("eMediplan: einlesen, prüfen und Zeile übernehmen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Amlodipin E2E ${Date.now()}`;
  const code = `CHMED16A0${JSON.stringify({
    Dt: "2026-10-01T10:00:00+02:00",
    Patient: { FName: "Gertrud", LName: "Planperson", BDt: "1938-04-02" },
    Medicaments: [
      {
        Id: "7680123456789",
        IdType: 2,
        Unit: "STK",
        TkgRsn: "Blutdruck",
        Pos: [{ DtFrom: "2026-10-01", D: [1, 0, 0.5, 0] }],
      },
      { Id: "Spezialschema", IdType: 1, Pos: [{ DtFrom: "2026-10-01", TT: [{ Off: 28800, DoFrom: 1 }] }] },
    ],
  })}`;

  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.goto("/c/medikation/emediplan");
  await expect(page.getByRole("heading", { name: "eMediplan einlesen", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: /Inhalt des QR-Codes/ }).fill(code);
  await page.getByRole("button", { name: "Einlesen" }).click();

  await expect(page.locator(".emediplan-mismatch")).toContainText("Gertrud Planperson");
  await expect(page.getByRole("article", { name: "Zeile 2" })).toContainText("von Hand erfassen");
  await page.getByLabel("Morgen").fill("08:00");
  await page.getByLabel("Abend").fill("18:00");

  const line = page.getByRole("article", { name: "Zeile 1" });
  await expect(line).toContainText("GTIN 7680123456789");
  await expect(line.getByLabel("Dosis (Verordnung 1)")).toHaveValue("1 STK");
  await expect(line.getByLabel("Dosis (Verordnung 2)")).toHaveValue("0.5 STK");
  // Unabhängig von einer früher gemerkten Zuordnung: als neues Präparat erfassen.
  await line.getByRole("combobox", { name: "Präparat im eigenen Stamm" }).click();
  await page.getByRole("option", { name: "Neues Präparat erfassen" }).click();
  await line.getByLabel("Präparat", { exact: true }).fill(name);
  await line.getByLabel("Verordnet von").fill("Dr. Meier");
  await line.getByRole("button", { name: "Geprüft – als 2 Verordnungen übernehmen" }).click();
  await expect(line).toContainText("Übernommen");

  await page.goto("/c/medikation");
  await expect(page.getByText(name).first()).toBeVisible();
  expect(errors).toEqual([]);
});

// CHMED23A auf zwei QR-Codes verteilt: täglich zu festen Uhrzeiten, die Uhrzeiten kommen aus dem Plan.
test("eMediplan CHMED23A: zwei Teile, feste Uhrzeiten aus dem Plan", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Metformin E2E ${Date.now()}`;
  const data = gzipSync(
    Buffer.from(
      JSON.stringify({
        patient: { fName: "Gertrud", lName: "Planperson" },
        meds: [
          {
            id: name,
            idType: 1,
            rsn: "Diabetes",
            pos: [
              {
                dtFrom: "2026-10-01",
                unit: "TABL",
                po: {
                  t: 4,
                  cyDuU: 4,
                  cyDu: 1,
                  tdo: {
                    t: 2,
                    ts: [
                      { dt: "07:30:00", do: { t: 1, a: 1 } },
                      { dt: "19:30:00", do: { t: 1, a: 1 } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      }),
    ),
  ).toString("base64");
  const half = Math.ceil(data.length / 2);
  const code = [`CHMED23A.2/2.${data.slice(half)}`, `CHMED23A.1/2.${data.slice(0, half)}`].join("\n");

  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.goto("/c/medikation/emediplan");
  await page.getByRole("textbox", { name: /Inhalt des QR-Codes/ }).fill(code);
  await page.getByRole("button", { name: "Einlesen" }).click();
  const line = page.getByRole("article", { name: "Zeile 1" });
  await expect(line).toContainText("1 um 07:30, 1 um 19:30");
  await expect(line.locator(".emediplan-group")).toContainText("Uhrzeiten laut Plan");
  await line.getByLabel("Verordnet von").fill("Dr. Meier");
  await line.getByRole("button", { name: "Geprüft – als Verordnung übernehmen" }).click();
  await expect(line).toContainText("Übernommen");
  expect(errors).toEqual([]);
});
