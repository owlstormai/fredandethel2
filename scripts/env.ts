import { config } from "dotenv";
import path from "node:path";

/** Load .env.local then .env (Next.js precedence) unless DATABASE_URL already set. */
export function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  for (const file of [".env.local", ".env"]) {
    config({ path: path.resolve(process.cwd(), file) });
  }
}
