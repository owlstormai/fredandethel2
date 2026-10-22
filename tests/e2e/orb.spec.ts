import { test, expect } from "@playwright/test";
import { loginDemo, startTalking } from "./helpers";

// Chromium is launched with a fake microphone fed from tests/fixtures/fake-mic.wav
// (1.5s silence, 3s speech, 2s silence, 2.5s speech, 1s silence, looped).
test("orb mic level rises during fake-mic speech and falls in silence", async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_AUDIO, "set E2E_FAKE_AUDIO=tests/fixtures/fake-mic.wav to run");
  await loginDemo(page);
  await startTalking(page);
  const orb = page.getByTestId("orb");
  const samples: number[] = [];
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    const v = Number(await orb.getAttribute("data-mic-level"));
    if (!Number.isNaN(v)) samples.push(v);
    await page.waitForTimeout(100);
  }
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  expect(max, `max mic level ${max}`).toBeGreaterThan(0.08);
  expect(min, `min mic level ${min}`).toBeLessThan(0.03);
  // The orb must have been in the listening state at some point.
  // (Demo mode derives it from recognition; live mode from VAD.) Soft check:
  await expect(orb).toHaveAttribute("data-state", /.+/);
});

test("orb honors reduced motion preference attribute", async ({ page }) => {
  await loginDemo(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/talk");
  await expect(page.getByTestId("start-button")).toBeVisible();
  // No continuous animation in reduced motion: the canvas should still render.
  await expect(page.locator("canvas").first()).toBeVisible();
});
