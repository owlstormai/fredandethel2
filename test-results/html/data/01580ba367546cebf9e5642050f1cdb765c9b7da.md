# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: talk.spec.ts >> demo conversation >> ending the conversation shows a summary panel
- Location: tests/e2e/talk.spec.ts:58:7

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
          - list [ref=e75]:
            - listitem [ref=e76]:
              - generic [ref=e77]: Margaret
              - paragraph [ref=e78]: I used to teach fourth grade for thirty years.
  - generic "Notifications"
  - alert [ref=e79]
```

# Test source

```ts
  1  | import { expect, type APIRequestContext, type Page } from "@playwright/test";
  2  | 
  3  | export const DEMO_SLUG = "margaret";
  4  | 
  5  | /** Sign in as a demo profile via the API and keep the cookie on the page context. */
  6  | export async function loginDemo(page: Page, slug = DEMO_SLUG): Promise<void> {
  7  |   const res = await page.request.post("/api/auth/demo", { data: { slug } });
  8  |   expect(res.ok(), `demo login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  9  | }
  10 | 
  11 | export function uniqueEmail(prefix = "e2e"): string {
  12 |   return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  13 | }
  14 | 
  15 | export async function signup(request: APIRequestContext, email: string, password = "correct horse battery"): Promise<void> {
  16 |   const res = await request.post("/api/auth/signup", { data: { email, password, preferredName: "Tester" } });
  17 |   expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  18 | }
  19 | 
  20 | /** Start a conversation on /talk and wait until the orb leaves "connecting". */
  21 | export async function startTalking(page: Page): Promise<void> {
  22 |   await page.goto("/talk");
  23 |   await page.getByTestId("start-button").click();
  24 |   const orb = page.getByTestId("orb");
  25 |   await expect(orb).toBeVisible();
  26 |   await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("connecting");
  27 |   await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("offline");
  28 | }
  29 | 
  30 | /** Type a message using the text fallback and wait for an assistant reply after it. */
  31 | export async function say(page: Page, text: string): Promise<string> {
  32 |   const assistantBefore = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
  33 |   const before = await assistantBefore.count();
  34 |   await page.getByTestId("text-input").fill(text);
  35 |   await page.getByTestId("text-send").click();
  36 |   const assistant = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
> 37 |   await expect.poll(async () => assistant.count(), { timeout: 30_000 }).toBeGreaterThan(before);
     |                                                                         ^ Error: expect(received).toBeGreaterThan(expected)
  38 |   return (await assistant.last().innerText()).trim();
  39 | }
  40 | 
```