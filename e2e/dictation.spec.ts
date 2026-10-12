import { expect, test, type Page } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Spracheingabe nur mit Erkennung auf dem Gerät: Attrappe der Web Speech API statt Mikrofon.
async function fakeRecognition(page: Page, mode: "local" | "cloud-only" | "unavailable") {
  await page.addInitScript((kind) => {
    const calls: Array<{ lang: string; processLocally: boolean }> = [];
    const probes: string[] = [];
    (window as unknown as { __dictation: typeof calls; __probes: typeof probes }).__dictation = calls;
    (window as unknown as { __probes: typeof probes }).__probes = probes;
    class FakeRecognition extends EventTarget {
      lang = "";
      continuous = false;
      interimResults = true;
      processLocally = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      start() {
        calls.push({ lang: this.lang, processLocally: this.processLocally });
        const transcript = { transcript: "mobilisiert mit Rollator" };
        const result = Object.assign([transcript], { isFinal: true });
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [result] }), 50);
      }
      stop() {
        this.onend?.();
      }
    }
    const scope = window as unknown as { SpeechRecognition?: unknown };
    if (kind === "cloud-only") scope.SpeechRecognition = FakeRecognition;
    else
      scope.SpeechRecognition = Object.assign(FakeRecognition, {
        available: async () => {
          probes.push("available");
          return kind === "local" ? "available" : "unavailable";
        },
        install: async () => true,
      });
  }, mode);
}

const dictation = (page: Page, on: boolean) => page.request.patch("/api/me/settings", { data: { dictation: on } });

test("Spracheingabe: aus, bis die Person sie einschaltet – dann nur mit Erkennung auf dem Gerät", async ({ page }) => {
  await fakeRecognition(page, "unavailable");
  await login(page, ADMIN);
  await dictation(page, false);
  await page.goto("/c/pflegedokumentation");
  await expect(page.locator("textarea").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Diktieren" })).toHaveCount(0);
  const probes = await page.evaluate(() => (window as unknown as { __probes: string[] }).__probes);
  expect(probes).toEqual([]);

  // Eingeschaltet, aber ohne Erkennung auf dem Gerät: kein Knopf, kein Rückgriff auf die Cloud.
  await dictation(page, true);
  try {
    await page.reload();
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __probes: string[] }).__probes.length))
      .toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Diktieren" })).toHaveCount(0);
  } finally {
    await dictation(page, false);
  }
});

test("Spracheingabe: ohne Abfrage der lokalen Erkennung (nur Cloud) kein Knopf", async ({ page }) => {
  await fakeRecognition(page, "cloud-only");
  await login(page, ADMIN);
  await dictation(page, true);
  try {
    await page.goto("/c/pflegedokumentation");
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Diktieren" })).toHaveCount(0);
  } finally {
    await dictation(page, false);
  }
});

test("Spracheingabe: Erkennung auf dem Gerät ergänzt den Eintrag", async ({ page }) => {
  await fakeRecognition(page, "local");
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await dictation(page, true);
  try {
    await page.goto("/c/pflegedokumentation");
    const field = page.locator("textarea").first();
    await field.fill("Gut geschlafen.");
    await page.getByRole("button", { name: "Diktieren" }).first().click();
    await expect(field).toHaveValue("Gut geschlafen. Mobilisiert mit Rollator");
    const calls = await page.evaluate(
      () => (window as unknown as { __dictation: Array<{ lang: string; processLocally: boolean }> }).__dictation,
    );
    expect(calls).toEqual([{ lang: "de-CH", processLocally: true }]);
    await page.getByRole("button", { name: "Diktat beenden" }).first().click();
    await expect(page.getByRole("button", { name: "Diktieren" }).first()).toBeVisible();
  } finally {
    await dictation(page, false);
  }
  expect(errors).toEqual([]);
});
