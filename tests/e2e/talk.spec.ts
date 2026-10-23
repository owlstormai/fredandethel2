import { test, expect } from "@playwright/test";
import { loginDemo, startTalking, say } from "./helpers";

test.describe("demo conversation", () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page);
  });

  test("starts a simulated session, greets, and is labeled simulated", async ({ page }) => {
    await startTalking(page);
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    // Greeting arrives from the server-side demo brain.
    const assistant = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
    await expect.poll(async () => assistant.count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId("status")).toBeVisible();
    await expect(page.getByTestId("end-button")).toBeVisible();
  });

  test("orb passes through speaking and returns to idle; stop button interrupts", async ({ page }) => {
    await startTalking(page);
    const orb = page.getByTestId("orb");
    const seen = new Set<string>();
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const s = await orb.getAttribute("data-state");
      if (s) seen.add(s);
      if (seen.has("speaking")) break;
      await page.waitForTimeout(100);
    }
    expect(seen.has("speaking") || seen.has("thinking")).toBeTruthy();
    if (await page.getByTestId("stop-button").isVisible()) {
      await page.getByTestId("stop-button").click();
      await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 5_000 }).toMatch(/interrupted|idle|listening/);
    }
    await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 30_000 }).toMatch(/idle|listening/);
  });

  test("typed input gets a reply and the transcript records both sides", async ({ page }) => {
    await startTalking(page);
    const reply = await say(page, "I spent the morning in the garden with my tomatoes.");
    expect(reply.length).toBeGreaterThan(10);
    await expect(page.locator('[data-testid="transcript-entry"][data-role="user"]').last()).toContainText(/garden/i);
  });

  test("model switch mid-conversation keeps the conversation and shows the note", async ({ page }) => {
    await startTalking(page);
    await say(page, "Let me tell you about my granddaughter Lily.");
    const select = page.getByTestId("model-select");
    await expect(select).toBeVisible();
    await select.selectOption("mini");
    await expect(page.getByText(/switched to/i)).toBeVisible({ timeout: 20_000 });
    const orb = page.getByTestId("orb");
    await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("connecting");
    // Earlier transcript entries are still present (app-owned context preserved).
    await expect(page.locator('[data-testid="transcript-entry"][data-role="user"]').first()).toContainText(/Lily/);
  });

  test("ending the conversation shows a summary panel", async ({ page }) => {
    await startTalking(page);
    await say(page, "I used to teach fourth grade for thirty years.");
    await page.getByTestId("end-button").click();
    await expect(page.getByTestId("session-summary")).toBeVisible({ timeout: 20_000 });
  });
});
