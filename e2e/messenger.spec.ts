import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, login, watchErrors } from "./support";

// Messenger: @Erwähnung mit Namensvorschlag, Reaktion und Benachrichtigung der erwähnten Person.
test("Messenger: Person erwähnen und auf eine Nachricht reagieren", async ({ page }) => {
  await login(page, FAGE);
  const lena = (
    (await (await page.request.get("/api/conversations")).json()) as {
      actor: { id: string; displayName: string };
    }
  ).actor;
  await page.context().clearCookies();

  await login(page, ADMIN);
  const errors = watchErrors(page);
  const title = `E2E Frühdienst ${Date.now()}`;
  const created = await page.request.post("/api/conversations", {
    data: { action: "conversation", kind: "group", title, memberIds: [lena.id] },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/c/carecore-one/messenger?conversation=${id}`);
  await expect(page.locator(".chat-head")).toContainText(title);
  const input = page.getByLabel("Nachricht", { exact: true });
  await input.fill(`@${lena.displayName.slice(0, 3)}`);
  await page.getByRole("listbox", { name: "Person erwähnen" }).getByRole("option", { name: lena.displayName }).click();
  await expect(input).toHaveValue(`@${lena.displayName} `);
  await input.pressSequentially("bitte Zimmer 12 übernehmen");
  await page.getByRole("button", { name: "Nachricht senden" }).click();

  const row = page.locator(".chat-message", { hasText: "bitte Zimmer 12 übernehmen" });
  await expect(row.locator(".chat-mention")).toHaveText(`@${lena.displayName}`);
  await row.hover();
  await row.getByRole("button", { name: "Mit 👍 reagieren" }).click();
  const reaction = row.locator(".chat-reactions button", { hasText: "👍" });
  await expect(reaction).toHaveText("👍 1");
  await expect(reaction).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);

  // Die erwähnte Person erhält eine Benachrichtigung mit Link in die Unterhaltung.
  await page.context().clearCookies();
  await login(page, FAGE);
  const { notifications } = (await (await page.request.get("/api/notifications")).json()) as {
    notifications: Array<{ type: string; body: string; link_url: string }>;
  };
  const mention = notifications.find((item) => item.type === "message_mention" && item.body.startsWith(title));
  expect(mention?.link_url).toBe(`/c/carecore-one/messenger?conversation=${id}`);
});

// Wie im Team-Chat: antworten, Datei aus der Ablage anhängen, anheften, bearbeiten, löschen, als Aufgabe übernehmen.
test("Messenger: antworten, Datei aus der Ablage, anheften, bearbeiten, löschen und Aufgabe", async ({ page }) => {
  await login(page, FAGE);
  const lena = ((await (await page.request.get("/api/conversations")).json()) as { actor: { id: string } }).actor;
  await page.context().clearCookies();
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const title = `E2E Spätdienst ${stamp}`;
  const { id } = (await (
    await page.request.post("/api/conversations", {
      data: { action: "conversation", kind: "group", title, memberIds: [lena.id] },
    })
  ).json()) as { id: string };
  const fileName = `Übergabe ${stamp}.txt`;
  await page.request.post("/api/cloud/files", {
    multipart: {
      scope: "shared",
      file: { name: fileName, mimeType: "text/plain", buffer: Buffer.from("Zimmer 3: Sturzrisiko") },
    },
  });

  await page.goto(`/c/carecore-one/messenger?conversation=${id}`);
  const input = page.getByLabel("Nachricht", { exact: true });
  await input.fill("Wer übernimmt **Zimmer 3**?");
  await input.press("Enter");
  // Die erste Nachricht (die Antwort zitiert sie später ebenfalls).
  const first = page.locator(".chat-message", { hasText: "Wer übernimmt Zimmer 3?" }).first();
  await expect(first.locator("strong", { hasText: "Zimmer 3" })).toBeVisible();

  // Antworten mit Zitat und Datei aus der gemeinsamen Ablage.
  await first.hover();
  await first.getByRole("button", { name: "Antworten" }).click();
  await expect(page.locator(".chat-composer-context")).toContainText("Wer übernimmt Zimmer 3?");
  await page.getByRole("button", { name: "Datei anhängen" }).click();
  await page.getByRole("menuitem", { name: "Aus der Ablage" }).click();
  const picker = page.getByRole("dialog", { name: "Aus der Ablage" });
  await picker.getByRole("button", { name: new RegExp(fileName) }).click();
  await picker.getByRole("button", { name: "Anhängen" }).click();
  await expect(page.locator(".chat-pending")).toContainText(fileName);
  await input.fill("Ich, Infos im Anhang");
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  const answer = page.locator(".chat-message", { hasText: "Ich, Infos im Anhang" });
  await expect(answer.locator(".chat-quote")).toContainText("Wer übernimmt Zimmer 3?");
  await expect(answer.locator(".chat-file")).toContainText(fileName);
  await page.getByRole("tab", { name: /Dateien/ }).click();
  await expect(page.locator(".chat-files")).toContainText(fileName);
  await page.getByRole("tab", { name: "Chat" }).click();

  // Anheften, bearbeiten (Pfeil nach oben), löschen.
  await first.hover();
  await first.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Anheften" }).click();
  await expect(page.locator(".chat-pinned-bar")).toContainText("Wer übernimmt Zimmer 3?");
  await input.click();
  await input.press("ArrowUp");
  await expect(page.locator(".chat-composer-context")).toContainText("Nachricht bearbeiten");
  await input.fill("Ich, Infos im Anhang (Sturzrisiko beachten)");
  await page.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(answer).toContainText("Sturzrisiko beachten");
  await expect(answer).toContainText("bearbeitet");
  await answer.hover();
  await answer.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Als Aufgabe übernehmen" }).click();
  const taskDialog = page.getByRole("dialog", { name: "Als Aufgabe übernehmen" });
  await taskDialog.getByLabel("Aufgabe").fill(`Sturzrisiko Zimmer 3 ${stamp}`);
  await taskDialog.getByRole("button", { name: "Aufgabe erstellen" }).click();
  await expect(page.getByText("Aufgabe erstellt")).toBeVisible();
  const tasks = (await (await page.request.get("/api/tasks")).json()) as { tasks?: Array<{ title: string }> };
  expect(JSON.stringify(tasks)).toContain(`Sturzrisiko Zimmer 3 ${stamp}`);
  await answer.hover();
  await answer.getByRole("button", { name: "Weitere Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Löschen" }).click();
  await expect(page.locator(".chat-deleted")).toHaveText("Diese Nachricht wurde gelöscht.");
  expect(errors).toEqual([]);
});
