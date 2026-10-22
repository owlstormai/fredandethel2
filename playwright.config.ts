import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(__dirname, ".env.test") });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// The cloud dev container ships Chromium at /opt/pw-browsers (a different
// revision than this Playwright version expects). Use it when present.
const executablePath = process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/html" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "off",
    permissions: ["microphone"],
    launchOptions: {
      executablePath: process.env.PW_USE_BUNDLED_BROWSER ? undefined : executablePath,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        // Feed a WAV file as the microphone when provided (tests set it).
        ...(process.env.E2E_FAKE_AUDIO ? [`--use-file-for-fake-audio-capture=${process.env.E2E_FAKE_AUDIO}`] : []),
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build:e2e && npx next start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/companion_test",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "test-secret-0123456789abcdef0123456789abcdef",
      COMPANION_ENABLE_DEMO_PROFILES: "true",
      // Live mode e2e only runs when the key is present in the environment.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
  },
});
