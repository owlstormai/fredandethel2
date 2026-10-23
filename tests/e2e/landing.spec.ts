import { test, expect } from "@playwright/test";

test.describe("landing and auth", () => {
  test("landing shows demo profiles, Fred and Ethel, and labels demo as simulated", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-profile-margaret")).toBeVisible();
    await expect(page.getByTestId("demo-profile-walter")).toBeVisible();
    await expect(page.getByText(/Fred/).first()).toBeVisible();
    await expect(page.getByText(/Ethel/).first()).toBeVisible();
    await expect(page.getByText(/simulated/i).first()).toBeVisible();
    await expect(page.getByTestId("cta-signin")).toBeVisible();
    await expect(page.getByTestId("cta-signup")).toBeVisible();
  });

  test("demo profile button signs in and lands on /talk", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("demo-profile-margaret").click();
    await page.waitForURL(/\/talk/);
    await expect(page.getByTestId("start-button")).toBeVisible();
  });

  test("signup, logout, login round trip", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill(email);
    await page.getByTestId("signup-password").fill("correct horse battery");
    await page.getByTestId("signup-name").fill("Paul");
    await page.getByTestId("signup-submit").click();
    await page.waitForURL(/\/talk/);
    const me = await page.request.get("/api/me");
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).profile.preferredName).toBe("Paul");

    const out = await page.request.post("/api/auth/logout");
    expect(out.ok()).toBeTruthy();
    expect((await page.request.get("/api/me")).status()).toBe(401);

    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill("correct horse battery");
    await page.getByTestId("login-submit").click();
    await page.waitForURL(/\/talk/);
  });

  test("protected pages redirect when signed out", async ({ page }) => {
    await page.goto("/memory");
    await page.waitForURL(/\/login/);
  });
});
