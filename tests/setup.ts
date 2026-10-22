import { config } from "dotenv";
import path from "node:path";

// Tests always run against the test database and never against .env.local.
config({ path: path.resolve(process.cwd(), ".env.test") });
if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: "test" });
}
