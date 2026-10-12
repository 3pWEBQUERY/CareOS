import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Kennzahlen-Seiten einrichten: Bausteine verschieben, Breite wählen, unter den vorherigen stapeln, ausblenden;
// die Anordnung gilt je Person und Seite und bleibt nach dem Neuladen.
test("Kennzahlen Personal: Ansicht anpassen, stapeln, Breite, ausblenden, gespeichert, zurücksetzen", async ({
  page,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/kennzahlen/personal");
  // Zeilen und Spalten als Liste: [[["kpis"]], [["staffing"], ["absences", "trainings"]]].
  const rows = () =>
    page
      .locator(".page-board-row")
      .evaluateAll((nodes) =>
        nodes.map((row) =>
          [...row.querySelectorAll(":scope > .page-board-column")].map((column) =>
            [...column.querySelectorAll(":scope > .page-board-widget")].map((widget) =>
              widget.getAttribute("data-widget"),
            ),
          ),
        ),
      );
  await expect.poll(rows).toEqual([[["kpis"]], [["staffing"], ["absences", "trainings"]]]);

  await page.getByRole("button", { name: "Ansicht anpassen" }).click();
  // Pflichtschulungen in eine eigene Spalte (eigene Zeile, weil die Zeile schon voll ist).
  await page.getByRole("button", { name: "Pflichtschulungen unter den vorherigen stellen" }).click();
  await expect.poll(rows).toEqual([[["kpis"]], [["staffing"], ["absences"]], [["trainings"]]]);
  // Besetzung auf volle Breite, Abwesenheiten nach vorne, Kennzahlen ausblenden.
  await page.getByRole("combobox", { name: "Breite von Besetzung nach Wohnbereich" }).click();
  await page.getByRole("option", { name: "Voll" }).click();
  await page.getByRole("button", { name: "Abwesenheiten nach vorne" }).click();
  await page.getByRole("button", { name: "Kennzahlen ausblenden" }).click();
  await expect.poll(rows).toEqual([[["absences"]], [["staffing"]], [["trainings"]]]);
  await page.getByRole("button", { name: "Fertig" }).click();

  // Aus der Datenbank (ohne Browser-Speicher) gleich angeordnet; andere Kennzahlen-Seiten unberührt.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(rows).toEqual([[["absences"]], [["staffing"]], [["trainings"]]]);
  await page.goto("/c/leitung/kennzahlen/leitung");
  await expect.poll(rows).toEqual([[["kpis"]], [["cockpit"], ["decisions"]]]);

  // Zurücksetzen.
  await page.goto("/c/leitung/kennzahlen/personal");
  await page.getByRole("button", { name: "Ansicht anpassen" }).click();
  await page.getByRole("button", { name: "Standard wiederherstellen" }).click();
  await expect.poll(rows).toEqual([[["kpis"]], [["staffing"], ["absences", "trainings"]]]);
  expect(errors).toEqual([]);
});
