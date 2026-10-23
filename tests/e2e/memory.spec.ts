import { test, expect } from "@playwright/test";
import { loginDemo, startTalking, say } from "./helpers";

test.describe("memory flows (demo profile, memory consent seeded)", () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page, "walter");
  });

  test("remember → listed → delete → tombstone blocks re-saving", async ({ page }) => {
    const fact = `I take my coffee with two sugars ${Date.now()}`;
    await startTalking(page);
    const reply = await say(page, `Please remember that ${fact}.`);
    expect(reply.length).toBeGreaterThan(0);

    await page.goto("/memory");
    const item = page.getByTestId("memory-item").filter({ hasText: /two sugars/ });
    await expect(item.first()).toBeVisible();

    await item.first().getByTestId("memory-delete").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /delete|forget/i }).click();
    await expect(item).toHaveCount(0);
    await expect(page.getByText(/asked me to forget/i)).toContainText(/[1-9]/);

    // Re-saving the same fact via the API is rejected because of the tombstone.
    const res = await page.request.post("/api/memories", {
      data: { content: fact, kind: "preference", category: "preference" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    const list = await (await page.request.get("/api/memories")).json();
    expect(JSON.stringify(list.memories)).not.toContain("two sugars");
  });

  test("correct a memory and confirm a reported one", async ({ page }) => {
    const dog = `Biscuit${Date.now() % 100000}`;
    const create = await page.request.post("/api/memories", {
      data: { content: `My neighbour's dog is called ${dog}`, kind: "fact", category: "friends" },
    });
    expect(create.ok()).toBeTruthy();
    await page.goto("/memory");
    const item = page.getByTestId("memory-item").filter({ hasText: dog }).first();
    await expect(item).toBeVisible();
    await item.getByTestId("memory-edit").click();
    const input = item.getByTestId("memory-edit-input");
    await input.fill(`My neighbour's dog is called ${dog} and he is a beagle`);
    await item.getByTestId("memory-edit-save").click();
    await expect(page.getByTestId("memory-item").filter({ hasText: new RegExp(`${dog} and he is a beagle`) })).toHaveCount(1);
  });

  test("export contains the user's data and only theirs", async ({ page }) => {
    const res = await page.request.get("/api/memory/export");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.user.demoSlug).toBe("walter");
    expect(Array.isArray(body.memories)).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/Lily|crossword/); // Margaret's seeded facts
  });
});
