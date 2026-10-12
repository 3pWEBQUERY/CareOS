import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Ablage wie der Dateibereich eines Teams: Ordner anlegen, hochladen, Dokument bearbeiten (Versionen),
// umbenennen, verschieben, löschen mit Rückgängig, Papierkorb und Ordner als ZIP.
test("Ablage: Ordner, Hochladen, Bearbeiten mit Versionen, Verschieben, Papierkorb und ZIP", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const folder = `E2E Hygiene ${stamp}`;
  await page.goto("/c/carecore-one/ablage");
  await expect(page.getByRole("heading", { name: "Gemeinsame Ablage", level: 1 })).toBeVisible();

  // Neuer Ordner über „Neu“.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Ordner" }).click();
  const nameDialog = page.getByRole("dialog", { name: "Neuer Ordner" });
  await nameDialog.getByLabel("Name").fill(folder);
  await nameDialog.getByRole("button", { name: "Ordner anlegen" }).click();
  await page.getByRole("button", { name: folder, exact: true }).first().click();
  await expect(page.locator(".files-breadcrumb")).toContainText(folder);

  // Hochladen in den geöffneten Ordner; gleicher Name fragt nach.
  const input = page.getByLabel("Dateien auswählen");
  await input.setInputFiles({ name: "Plan.txt", mimeType: "text/plain", buffer: Buffer.from("Plan A") });
  await expect(page.locator(".files-table")).toContainText("Plan.txt");
  await input.setInputFiles({ name: "Plan.txt", mimeType: "text/plain", buffer: Buffer.from("Plan B") });
  const conflict = page.getByRole("dialog", { name: "Datei gibt es bereits" });
  await conflict.getByRole("button", { name: "Ersetzen" }).click();
  await expect(page.locator(".files-table tr", { hasText: "Plan.txt" }).locator(".files-version")).toHaveText("V2");

  // Neue einfache Textdatei anlegen und bearbeiten.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Einfacher Text" }).click();
  const documentDialog = page.getByRole("dialog", { name: "Neue einfache Datei" });
  await documentDialog.getByLabel("Name").fill("Merkblatt");
  await documentDialog.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const editor = page.getByRole("dialog", { name: "Merkblatt.txt" });
  await editor.getByLabel("Inhalt").fill("Hände vor und nach jedem Kontakt desinfizieren.");
  await editor.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert – neue Version angelegt")).toBeVisible();
  await editor.getByRole("button", { name: "Fenster schliessen" }).click();

  // Details mit Versionen; umbenennen.
  const row = page.locator(".files-table tbody tr", { hasText: "Merkblatt.txt" });
  await row.click();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.locator(".files-versions")).toContainText("Version 2 · aktuell");
  await expect(page.locator(".files-versions")).toContainText("Version 1");
  await page.getByRole("toolbar", { name: "Befehle" }).getByRole("button", { name: "Umbenennen" }).click();
  const rename = page.getByRole("dialog", { name: /umbenennen/ });
  await rename.getByLabel("Neuer Name").fill("Merkblatt Händehygiene.txt");
  await rename.getByRole("button", { name: "Umbenennen" }).click();
  await expect(page.locator(".files-table")).toContainText("Merkblatt Händehygiene.txt");

  // Verschieben in die oberste Ebene und zurück über den Pfad.
  await page.locator(".files-table tbody tr", { hasText: "Plan.txt" }).click();
  await page.getByRole("toolbar", { name: "Befehle" }).getByRole("button", { name: "Verschieben" }).click();
  const picker = page.getByRole("dialog", { name: /verschieben nach/ });
  await picker.getByRole("button", { name: "Gemeinsame Ablage" }).click();
  await picker.getByRole("button", { name: "Hierher verschieben" }).click();
  await expect(page.locator(".files-table tbody tr", { hasText: "Plan.txt" })).toHaveCount(0);
  await page.locator(".files-breadcrumb").getByRole("button", { name: "Gemeinsame Ablage" }).click();
  await expect(page.locator(".files-table")).toContainText("Plan.txt");

  // Löschen mit Rückgängig, dann Papierkorb und Wiederherstellen.
  await page.locator(".files-table tbody tr", { hasText: "Plan.txt" }).click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".files-table tbody tr", { hasText: "Plan.txt" })).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.locator(".files-table")).toContainText("Plan.txt");
  await page.locator(".files-table tbody tr", { hasText: "Plan.txt" }).click();
  await page.getByRole("toolbar", { name: "Befehle" }).getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("button", { name: "Papierkorb" }).click();
  const trashRow = page.locator(".files-table tbody tr", { hasText: "Plan.txt" });
  await expect(trashRow).toBeVisible();
  await trashRow.click();
  await page.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.locator(".files-table tbody tr", { hasText: "Plan.txt" })).toHaveCount(0);
  await page.getByRole("button", { name: "Alle Dateien" }).click();
  await expect(page.locator(".files-table")).toContainText("Plan.txt");

  // Ordner als ZIP herunterladen.
  await page.locator(".files-table tbody tr", { hasText: folder }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("toolbar", { name: "Befehle" }).getByRole("button", { name: "Herunterladen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${folder}.zip`);
  const zip = await file.createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  });
  expect(zip.subarray(0, 2).toString()).toBe("PK");
  expect(zip.toString("utf8")).toContain(`${folder}/Merkblatt Händehygiene.txt`);
  expect(errors).toEqual([]);
});
