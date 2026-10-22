/**
 * Integration test helpers. Tests run against the REAL test database
 * (.env.test -> companion_test). Files run serially (vitest fileParallelism=false).
 */
import { closePool, query } from "@/lib/database/client";
import { runMigrations } from "@/lib/database/migrate";
import { signUp } from "@/lib/auth/service";
import { resetRateLimits } from "@/lib/privacy/rateLimit";
import type { User } from "@/lib/types";

const TABLES = [
  "usage_events",
  "memory_events",
  "memory_tombstones",
  "memories",
  "conversation_messages",
  "conversations",
  "consent_records",
  "preferences",
  "profiles",
  "users",
  "model_configs",
];

export async function ensureSchema(): Promise<void> {
  if (!/companion_test/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Integration tests must run against companion_test (tests/setup.ts loads .env.test).");
  }
  await runMigrations();
}

export async function truncateAll(): Promise<void> {
  await query(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  resetRateLimits();
}

export async function teardown(): Promise<void> {
  await closePool();
}

let counter = 0;
export async function createUser(options: { email?: string; preferredName?: string } = {}): Promise<{ user: User; password: string; tokenVersion: number }> {
  counter += 1;
  const email = options.email ?? `user${counter}-${Date.now()}@example.test`;
  const password = "correct horse battery staple";
  const { user, tokenVersion } = await signUp({ email, password, preferredName: options.preferredName });
  return { user, password, tokenVersion };
}

/**
 * An in-memory stand-in for next/headers cookies(). Test files install it with
 *   vi.mock("next/headers", async () => ({ cookies: async () => (await import("./helpers")).cookieJar }));
 */
export const cookieJar = {
  store: new Map<string, string>(),
  get(name: string) {
    const value = this.store.get(name);
    return value === undefined ? undefined : { name, value };
  },
  getAll() {
    return Array.from(this.store, ([name, value]) => ({ name, value }));
  },
  has(name: string) {
    return this.store.has(name);
  },
  set(name: string, value: string, options?: { maxAge?: number }) {
    if (options?.maxAge === 0 || value === "") this.store.delete(name);
    else this.store.set(name, value);
  },
  delete(name: string) {
    this.store.delete(name);
  },
  reset() {
    this.store.clear();
  },
};

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const params = (id: string) => ({ params: Promise.resolve({ id }) });

export async function readJson<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
