import { test, expect } from "@playwright/test";
import { loginDemo } from "./helpers";

test("settings persist and theme attributes apply", async ({ page }) => {
  await loginDemo(page);
  await page.goto("/settings");
  await page.getByTestId("pref-humor-playful").click();
  await page.getByTestId("pref-color-violet").click();
  await page.getByTestId("pref-textscale-xlarge").click();
  await page.getByTestId("pref-pause-balanced").click();
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.orbColor)).toBe("violet");
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.textScale)).toBe("xlarge");

  await page.reload();
  await expect(page.getByTestId("pref-humor-playful")).toHaveAttribute(/aria-pressed|aria-checked|data-selected/, /true/);
  const me = await (await page.request.get("/api/me")).json();
  expect(me.preferences.humorLevel).toBe("playful");
  expect(me.preferences.orbColor).toBe("violet");
  expect(me.preferences.pauseSensitivity).toBe("balanced");

  // Restore defaults for other tests.
  await page.request.patch("/api/preferences", { data: { humorLevel: "gentle", orbColor: "cyan", textScale: "large", pauseSensitivity: "patient" } });
});
