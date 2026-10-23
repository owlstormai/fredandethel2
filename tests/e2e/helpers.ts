import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const DEMO_SLUG = "margaret";

/** Sign in as a demo profile via the API and keep the cookie on the page context. */
export async function loginDemo(page: Page, slug = DEMO_SLUG): Promise<void> {
  const res = await page.request.post("/api/auth/demo", { data: { slug } });
  expect(res.ok(), `demo login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function signup(request: APIRequestContext, email: string, password = "correct horse battery"): Promise<void> {
  const res = await request.post("/api/auth/signup", { data: { email, password, preferredName: "Tester" } });
  expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** Start a conversation on /talk and wait until the orb leaves "connecting". */
export async function startTalking(page: Page): Promise<void> {
  await page.goto("/talk");
  await page.getByTestId("start-button").click();
  const orb = page.getByTestId("orb");
  await expect(orb).toBeVisible();
  await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("connecting");
  await expect.poll(async () => orb.getAttribute("data-state"), { timeout: 20_000 }).not.toBe("offline");
}

/** Wait until the companion has finished speaking (so typing does not interrupt it). */
export async function waitForQuiet(page: Page, timeout = 45_000): Promise<void> {
  const orb = page.getByTestId("orb");
  await expect.poll(async () => orb.getAttribute("data-state"), { timeout }).toMatch(/^(idle|listening|muted)$/);
}

/** Type a message using the text fallback and return the companion's completed reply to it. */
export async function say(page: Page, text: string): Promise<string> {
  await waitForQuiet(page);
  const assistant = page.locator('[data-testid="transcript-entry"][data-role="assistant"]');
  const before = await assistant.count();
  await page.getByTestId("text-input").fill(text);
  await page.getByTestId("text-send").click();
  await expect.poll(async () => assistant.count(), { timeout: 30_000 }).toBeGreaterThan(before);
  const reply = assistant.nth(before);
  await expect(reply).toHaveAttribute("data-final", "true", { timeout: 60_000 });
  return (await reply.innerText()).trim();
}
