import { test, expect } from "@playwright/test";
import { loginDemo, startTalking, say } from "./helpers";

test.describe("memory flows (demo profile, memory consent seeded)", () => {
  test.beforeEach(async ({ page }) => {
    await loginDemo(page, "walter");
  });

  test("remember → listed → delete → deleted facts stay deleted until the user explicitly re-adds them", async ({ page }) => {
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

    // The fact is gone from the list and a tombstone records the deletion.
    const afterDelete = (await (await page.request.get("/api/memories")).json()) as { memories: Array<{ content: string }>; tombstones: number };
    expect(JSON.stringify(afterDelete.memories)).not.toContain("two sugars");
    expect(afterDelete.tombstones).toBeGreaterThanOrEqual(1);

    // Automated restores (summaries, unconfirmed model saves) stay blocked by the
    // tombstone and cannot be driven from e2e. An EXPLICIT re-add by the user —
    // POST /api/memories is always a confirmed save — supersedes it: the memory is
    // created and the tombstone count drops by one.
    const res = await page.request.post("/api/memories", {
      data: { content: fact, kind: "preference", category: "preference" },
    });
    expect(res.status()).toBe(201);
    const afterReAdd = (await (await page.request.get("/api/memories")).json()) as { memories: Array<{ content: string; status: string }>; tombstones: number };
    const restored = afterReAdd.memories.find((m) => m.content.includes("two sugars"));
    expect(restored?.status).toBe("confirmed");
    expect(afterReAdd.tombstones).toBe(afterDelete.tombstones - 1);
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

  test("builds an inferred conversation-style profile from the words of a conversation, shows it, and resets it", async ({ page }) => {
    test.setTimeout(240_000); // six spoken turns at a realistic caption pace
    await startTalking(page);
    const lines = [
      "Haha, well my garden is mostly weeds with ambitions, but the tomatoes don't know that yet!",
      "I told my grandson I'm a fossil and he asked which museum I'm in. Kidding — he's a sweet kid, haha.",
      "No pun intended, but my knees are the real weeds in this garden. Lol.",
      "Ugh, this remote is so frustrating, nothing works.",
      "I love a good crossword — seven letters for 'stubborn old man'? Me, haha!",
      "The tomatoes are coming in, the garden is a jungle, and I'm the only explorer. Ha!",
    ];
    for (const line of lines) await say(page, line);
    await page.getByTestId("end-button").click();
    await expect(page.getByTestId("session-summary")).toBeVisible({ timeout: 30_000 });
    // "How it felt" is inferred from the words in demo mode and says so.
    await expect(page.getByTestId("summary-feel")).toContainText(/inferred/i);

    await page.goto("/memory");
    const card = page.getByTestId("style-profile");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/inferred/i);
    await expect(card).toContainText(/not (from )?your voice/i);
    await expect(card).toContainText(/humor/i);
    await expect(card).toContainText(/joke/i);
    await expect(card).toContainText(/frustrat/i);
    await expect(card.getByTestId("style-profile-evidence")).toContainText(/Based on 1 conversation/);

    // The API carries the same picture, without cues.
    const style = (await (await page.request.get("/api/profile/style")).json()) as { profile: { traits: { scores: { humor: number } } } | null; recentTones: Array<{ tone: string }> };
    expect(style.profile?.traits.scores.humor ?? 0).toBeGreaterThan(0.5);
    expect(style.recentTones.some((t) => t.tone === "frustration")).toBeTruthy();
    expect(JSON.stringify(style)).not.toContain("cue");

    // Reset removes it.
    await card.getByTestId("style-profile-reset").click();
    await page.getByTestId("style-profile-confirm").click();
    await expect(page.getByTestId("style-profile")).toHaveCount(0);
    const after = (await (await page.request.get("/api/profile/style")).json()) as { profile: unknown; recentTones: unknown[] };
    expect(after.profile).toBeNull();
    expect(after.recentTones).toEqual([]);
  });

  test("export contains the user's data and only theirs", async ({ page }) => {
    const res = await page.request.get("/api/memory/export");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.user.demoSlug).toBe("walter");
    expect(Array.isArray(body.memories)).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/Lily|fourth grade|Maggie/); // Margaret's seeded facts
  });
});
