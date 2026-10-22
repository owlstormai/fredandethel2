# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: talk.spec.ts >> demo conversation >> starts a simulated session, greets, and is labeled simulated
- Location: tests/e2e/talk.spec.ts:9:7

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "Skip to content" [ref=e3] [cursor=pointer]:
      - /url: "#main"
    - banner [ref=e4]:
      - generic [ref=e5]:
        - link "Companion home" [ref=e6] [cursor=pointer]:
          - /url: /
          - generic [ref=e7]: Companion
        - navigation "Primary" [ref=e10]:
          - link "Talk" [ref=e11] [cursor=pointer]:
            - /url: /talk
          - link "Memory" [ref=e16] [cursor=pointer]:
            - /url: /memory
          - link "Settings" [ref=e21] [cursor=pointer]:
            - /url: /settings
          - link "Developer" [ref=e27] [cursor=pointer]:
            - /url: /developer
        - generic [ref=e31]:
          - link "Signed in as Margaret. Open settings." [ref=e32] [cursor=pointer]:
            - /url: /settings
            - generic [ref=e37]: Margaret
            - generic [ref=e38]: Demo profile
          - button "Sign out" [ref=e39]
    - main [ref=e43]:
      - generic [ref=e44]:
        - generic [ref=e45]:
          - generic [ref=e46]:
            - generic [ref=e47]: Simulated — no live AI
            - generic [ref=e48]: Ethel · 0 memories in use
          - generic [ref=e50]:
            - generic [ref=e51]: Voice model
            - combobox "Voice model" [ref=e53]:
              - option "Full quality" [selected]
              - option "Lower cost"
            - paragraph [ref=e54]: Switching reconnects; your memories and this conversation carry over.
        - generic [ref=e55]:
          - img "Ready. Speak whenever you like." [ref=e57]
          - paragraph [ref=e60]: I'm listening whenever you're ready.
        - generic [ref=e61]:
          - generic [ref=e62]:
            - button "Mute" [ref=e63]
            - button "End conversation" [ref=e69]
          - form "Type a message instead of speaking" [ref=e71]:
            - generic [ref=e72]:
              - text: Or type instead
              - textbox "Or type instead" [ref=e73]:
                - /placeholder: Type here and press Send
            - button "Send" [disabled]
        - log "Captions" [ref=e74]:
          - paragraph [ref=e75]: Captions will appear here as you talk.
  - generic "Notifications"
  - alert [ref=e76]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { loginDemo, startTalking, say } from "./helpers";
  3  | 
  4  | test.describe("demo conversation", () => {
  5  |   test.beforeEach(async ({ page }) => {
  6  |     await loginDemo(page);
  7  |   });
  8  | 
  9  |   test("starts a simulated session, greets, and is labeled simulated", async ({ page }) => {
  10 |     await startTalking(page);
  11 |     await expect(page.getByText(/simulated/i).first()).toBeVisible();
  12 |     // Greeting arrives from the server-side demo brain.
  13 |     const assistant = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
> 14 |     await expect.poll(async () => assistant.count(), { timeout: 30_000 }).toBeGreaterThan(0);
     |                                                                           ^ Error: expect(received).toBeGreaterThan(expected)
  15 |     await expect(page.getByTestId("status")).toBeVisible();
  16 |     await expect(page.getByTestId("end-button")).toBeVisible();
  17 |   });
  18 | 
  19 |   test("orb passes through speaking and returns to idle; stop button interrupts", async ({ page }) => {
  20 |     await startTalking(page);
  21 |     const orb = page.getByTestId("orb");
  22 |     const seen = new Set<string>();
  23 |     const deadline = Date.now() + 25_000;
  24 |     while (Date.now() < deadline) {
  25 |       const s = await orb.getAttribute("data-state");
  26 |       if (s) seen.add(s);
  27 |       if (seen.has("speaking")) break;
  28 |       await page.waitForTimeout(100);
  29 |     }
  30 |     expect(seen.has("speaking") || seen.has("thinking")).toBeTruthy();
  31 |     if (await page.getByTestId("stop-button").isVisible()) {
  32 |       await page.getByTestId("stop-button").click();
  33 |       await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 5_000 }).toMatch(/interrupted|idle|listening/);
  34 |     }
  35 |     await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 30_000 }).toMatch(/idle|listening/);
  36 |   });
  37 | 
  38 |   test("typed input gets a reply and the transcript records both sides", async ({ page }) => {
  39 |     await startTalking(page);
  40 |     const reply = await say(page, "I spent the morning in the garden with my tomatoes.");
  41 |     expect(reply.length).toBeGreaterThan(10);
  42 |     await expect(page.locator('[data-testid="transcript-entry"][data-role="user"]').last()).toContainText(/garden/i);
  43 |   });
  44 | 
  45 |   test("model switch mid-conversation keeps the conversation and shows the note", async ({ page }) => {
  46 |     await startTalking(page);
  47 |     await say(page, "Let me tell you about my granddaughter Lily.");
  48 |     const select = page.getByTestId("model-select");
  49 |     await expect(select).toBeVisible();
  50 |     await select.getByText(/lower cost|mini/i).click();
  51 |     await expect(page.getByText(/switched to/i)).toBeVisible({ timeout: 20_000 });
  52 |     const orb = page.getByTestId("orb");
  53 |     await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("connecting");
  54 |     // Earlier transcript entries are still present (app-owned context preserved).
  55 |     await expect(page.locator('[data-testid="transcript-entry"][data-role="user"]').first()).toContainText(/Lily/);
  56 |   });
  57 | 
  58 |   test("ending the conversation shows a summary panel", async ({ page }) => {
  59 |     await startTalking(page);
  60 |     await say(page, "I used to teach fourth grade for thirty years.");
  61 |     await page.getByTestId("end-button").click();
  62 |     await expect(page.getByTestId("session-summary")).toBeVisible({ timeout: 20_000 });
  63 |   });
  64 | });
  65 | 
```