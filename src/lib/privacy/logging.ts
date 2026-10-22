/**
 * Privacy-aware logging. Never log transcripts, memory contents, emails,
 * secrets or raw request bodies. Structured, redacted, and quiet in tests.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g, // OpenAI keys
  /ek_[A-Za-z0-9_-]{10,}/g, // ephemeral client secrets
  /postgres(ql)?:\/\/[^\s"']+/gi, // connection strings
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // emails
  /Bearer\s+[A-Za-z0-9._-]+/g,
];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[redacted]"), value);
  }
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message) };
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|authorization|content|transcript|email|api_key|apikey/i.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function emit(level: "info" | "warn" | "error", event: string, data?: unknown): void {
  if (process.env.NODE_ENV === "test" && !process.env.COMPANION_LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, data: redact(data) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logInfo = (event: string, data?: unknown) => emit("info", event, data);
export const logWarn = (event: string, data?: unknown) => emit("warn", event, data);
export const logError = (event: string, data?: unknown) => emit("error", event, data);
