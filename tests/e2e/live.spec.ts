import { test, expect } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

/**
 * LIVE acceptance tests — only run with OPENAI_API_KEY set in the environment
 * (the web server inherits it via playwright.config.ts). They cost real money
 * (a few cents each) and are reported honestly as skipped otherwise.
 */
const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 20);

test.describe("live mode (OpenAI Realtime over WebRTC)", () => {
  test.skip(!hasKey, "OPENAI_API_KEY not set — live tests skipped");

  test.beforeEach(async ({ page }) => {
    await signup(page.request, uniqueEmail("live"));
    await page.request.patch("/api/preferences", { data: { pauseSensitivity: "patient" } });
  });

  test("minted session config is server-side and the key never reaches the client", async ({ page }) => {
    const res = await page.request.post("/api/realtime/session", { data: { modelKey: "mini" } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.clientSecret).toMatch(/^ek_/);
    expect(JSON.stringify(body)).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(body.model.id).toMatch(/gpt-realtime/);
  });

  test("two-way conversation with fake-mic speech, barge-in stops output, pauses are tolerated", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/talk");
    await page.getByTestId("model-select").getByText(/lower cost|mini/i).click().catch(() => undefined);
    await page.getByTestId("start-button").click();
    const orb = page.getByTestId("orb");
    await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 30_000 }).not.toBe("connecting");
    await expect(page.getByText(/simulated/i)).toHaveCount(0);

    // Assistant greets (audio + transcript).
    const assistant = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
    await expect.poll(async () => assistant.count(), { timeout: 60_000 }).toBeGreaterThan(0);

    // Output level must move while speaking.
    let maxOut = 0;
    for (let i = 0; i < 100; i++) {
      maxOut = Math.max(maxOut, Number(await orb.getAttribute("data-output-level")) || 0);
      if (maxOut > 0.05) break;
      await page.waitForTimeout(100);
    }
    expect(maxOut).toBeGreaterThan(0.05);

    // Interrupt via Stop while speaking (if still speaking).
    if (await page.getByTestId("stop-button").isVisible()) {
      const t0 = Date.now();
      await page.getByTestId("stop-button").click();
      await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 5_000 }).not.toBe("speaking");
      expect(Date.now() - t0).toBeLessThan(2_000);
    }

    // The fake mic file contains a 2s pause inside the "utterance". With patient
    // semantic VAD we expect user turns to be registered without flooding.
    await page.waitForTimeout(15_000);
    const userTurns = await page.locator('[data-testid="transcript-entry"][data-role="user"]').count();
    expect(userTurns).toBeGreaterThanOrEqual(1);
    expect(userTurns).toBeLessThanOrEqual(6);

    await page.getByTestId("end-button").click();
    await expect(page.getByTestId("session-summary")).toBeVisible({ timeout: 30_000 });

    const usage = await (await page.request.get("/api/usage?range=today")).json();
    expect(usage.totals.estimatedCostUsd).toBeGreaterThan(0);
  });
});
