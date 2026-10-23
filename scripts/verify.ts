/**
 * `npm run verify` — acceptance checklist for a deployment environment.
 *
 * Prints PASS / FAIL / SKIP per check and exits non-zero on any FAIL.
 * SKIP is used when OPENAI_API_KEY is absent (demo-only deployments are valid).
 * Never prints secret values; env vars are shown masked.
 */
import { loadEnv } from "./env";
loadEnv();

import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  EPHEMERAL_KEY_TTL_SECONDS,
  getModelId,
  getSearchModelId,
  getTextModelId,
  getTranscriptionModelId,
  isLiveConfigured,
} from "../src/lib/ai/models";
import { createRealtimeClientSecret, openaiGet } from "../src/lib/ai/openai";
import { buildRealtimeSessionConfig } from "../src/lib/ai/realtime/sessionConfig";
import { closePool, query } from "../src/lib/database/client";

type Status = "PASS" | "FAIL" | "SKIP";
interface CheckResult { name: string; status: Status; detail: string }

const results: CheckResult[] = [];
function record(name: string, status: Status, detail = ""): void {
  results.push({ name, status, detail });
  const pad = status.padEnd(4);
  console.log(`${pad}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function mask(value: string | undefined): string {
  if (!value) return "missing";
  if (value.length <= 8) return `set (${value.length} chars)`;
  return `set (${value.length} chars, ends …${value.slice(-3)})`;
}

const REQUIRED_ENV = ["DATABASE_URL", "AUTH_SECRET"] as const;
const OPTIONAL_ENV = [
  "OPENAI_API_KEY",
  "COMPANION_DAILY_COST_CAP_USD",
  "COMPANION_PER_USER_DAILY_COST_CAP_USD",
  "COMPANION_MAX_SESSION_MINUTES",
  "COMPANION_ENABLE_DEMO_PROFILES",
  "COMPANION_VAD_MODE",
] as const;

async function checkEnv(): Promise<void> {
  for (const name of REQUIRED_ENV) {
    const value = process.env[name];
    const weak = name === "AUTH_SECRET" && (!value || value.length < 32 || /change-me/i.test(value));
    record(`env ${name}`, value && !weak ? "PASS" : "FAIL", weak ? "set but weak (use 32+ random chars)" : mask(value));
  }
  for (const name of OPTIONAL_ENV) {
    const value = process.env[name];
    if (name === "OPENAI_API_KEY") {
      record(`env ${name}`, value ? "PASS" : "SKIP", value ? mask(value) : "not set — demo mode only");
    } else {
      record(`env ${name}`, "PASS", value ? `= ${value}` : "default");
    }
  }
}

async function checkDatabase(): Promise<boolean> {
  try {
    await query("SELECT 1");
    record("database reachable", "PASS");
  } catch (error) {
    record("database reachable", "FAIL", (error as Error).message.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]"));
    return false;
  }
  try {
    const dir = path.join(process.cwd(), "src", "lib", "database", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
    const missing = files.filter((f) => !applied.has(f));
    record("migrations applied", missing.length === 0 ? "PASS" : "FAIL", missing.length ? `missing: ${missing.join(", ")}` : `${files.length} applied`);
    const tables = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','usage_events','memories','conversations')`,
    );
    record("core tables present", Number(tables[0]?.n) === 4 ? "PASS" : "FAIL");
  } catch (error) {
    record("migrations applied", "FAIL", (error as Error).message);
    return false;
  }
  return true;
}

async function checkOpenAI(): Promise<void> {
  const names = ["OPENAI_API_KEY valid", "realtime models available", "transcription model available", "text/search model available", "client secret mint"];
  if (!isLiveConfigured()) {
    for (const n of names) record(n, "SKIP", "no OPENAI_API_KEY");
    return;
  }

  let ids = new Set<string>();
  try {
    const list = await openaiGet<{ data?: Array<{ id: string }> }>("/models");
    ids = new Set((list.data ?? []).map((m) => m.id));
    record(names[0], "PASS", `${ids.size} models visible`);
  } catch (error) {
    record(names[0], "FAIL", (error as { code?: string }).code ?? (error as Error).message);
    for (const n of names.slice(1)) record(n, "SKIP", "key check failed");
    return;
  }

  const realtime = [getModelId("full"), getModelId("mini")];
  const missingRealtime = realtime.filter((id) => !ids.has(id));
  record(names[1], missingRealtime.length ? "FAIL" : "PASS", missingRealtime.length ? `not listed: ${missingRealtime.join(", ")}` : realtime.join(", "));

  const transcription = getTranscriptionModelId();
  record(names[2], ids.has(transcription) ? "PASS" : "FAIL", transcription);

  const text = [...new Set([getTextModelId(), getSearchModelId()])];
  const missingText = text.filter((id) => !ids.has(id));
  record(names[3], missingText.length ? "FAIL" : "PASS", missingText.length ? `not listed: ${missingText.join(", ")}` : text.join(", "));

  try {
    const config = buildRealtimeSessionConfig({
      modelId: getModelId("mini"),
      voice: "marin",
      instructions: "Verification ping. Say nothing.",
      pauseSensitivity: "patient",
      tools: [],
      transcriptionModel: transcription,
    });
    const secret = await createRealtimeClientSecret(config, 10);
    const ok = secret.value.startsWith("ek_") && new Date(secret.expiresAt).getTime() > Date.now();
    record(names[4], ok ? "PASS" : "FAIL", ok ? `ttl 10s (default ${EPHEMERAL_KEY_TTL_SECONDS}s), expires ${secret.expiresAt}` : "unexpected response shape");
  } catch (error) {
    record(names[4], "FAIL", (error as { code?: string }).code ?? (error as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("Companion verification\n");
  await checkEnv();
  const dbOk = await checkDatabase();
  await checkOpenAI();
  await closePool().catch(() => undefined);

  const fails = results.filter((r) => r.status === "FAIL").length;
  const skips = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n${results.length - fails - skips} passed, ${fails} failed, ${skips} skipped${dbOk ? "" : " (database checks incomplete)"}`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("verify crashed:", (error as Error).message);
  process.exit(1);
});
