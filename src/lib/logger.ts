export type LogLevel = "info" | "warn" | "error";

// Field names that must never reach a log line, whatever a caller passes by mistake.
const SECRET_KEY = /password|secret|token|authorization|cookie|database_url/i;

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : value,
    ]),
  );
}

// One JSON object per line: Vercel log search and `jq` can filter by field, e.g. requestId.
export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ...redact(fields), time: new Date().toISOString(), level, event });
  console[level === "info" ? "info" : level](line);
}

// Server-side detail only. Never put this in a response body (CLAUDE.md rule 10).
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorName: "NonError", errorMessage: String(error) };
}
