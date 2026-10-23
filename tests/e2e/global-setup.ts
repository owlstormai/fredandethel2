import { execFileSync } from "node:child_process";

/**
 * Playwright global setup: start every e2e run from a clean, seeded test
 * database so tombstones, duplicates and rate limits from a previous run
 * cannot leak into this one. Runs through tsx so tsconfig path aliases resolve.
 */
export default async function globalSetup(): Promise<void> {
  execFileSync("npx", ["tsx", "scripts/e2e-reset.ts"], { stdio: "inherit", env: process.env });
}
