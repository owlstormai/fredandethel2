import { test, expect } from "@playwright/test";
import { loginDemo, startTalking, say } from "./helpers";

test("developer panel shows usage, caps, pricing version and mode", async ({ page }) => {
  await loginDemo(page);
  await startTalking(page);
  await say(page, "Just saying hello to generate some usage.");
  await page.getByTestId("end-button").click();
  await page.goto("/developer");
  await expect(page.getByText(/estimate/i).first()).toBeVisible();
  await expect(page.getByText(/2026-10-22/)).toBeVisible();
  await expect(page.getByText(/demo/i).first()).toBeVisible();
  const usage = await (await page.request.get("/api/usage?range=today")).json();
  expect(usage.totals.sessions).toBeGreaterThan(0);
  expect(usage.caps.dailyCostCapUsd).toBeGreaterThan(0);
  expect(usage.pricingVersion).toBe("2026-10-22");
});
