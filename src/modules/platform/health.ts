import { errorFields, log } from "../../lib/logger";

export type HealthResult = { up: boolean; latencyMs: number };

type HealthCheckerOptions = {
  ping: () => Promise<void>;
  now: () => number;
  ttlMs: number;
  timeoutMs: number;
};

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database ping timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The last result is kept in memory for ttlMs. Why: a bot or uptime monitor calling /api/health
// every few seconds would otherwise keep the Neon compute awake and burn the free 100 CU-hours.
// Failures are cached too, so a dead database is not pinged by every caller. The cache lives per
// server instance; that is enough for this purpose.
export function createHealthChecker(options: HealthCheckerOptions): () => Promise<HealthResult> {
  let last: { result: HealthResult; at: number } | undefined;
  let inFlight: Promise<HealthResult> | undefined;

  async function run(): Promise<HealthResult> {
    const startedAt = options.now();
    let up = true;
    try {
      await withTimeout(options.ping(), options.timeoutMs);
    } catch (error) {
      up = false;
      log("warn", "health.database_down", errorFields(error));
    }
    const result = { up, latencyMs: options.now() - startedAt };
    last = { result, at: options.now() };
    return result;
  }

  return async () => {
    if (last && options.now() - last.at < options.ttlMs) return last.result;
    // Simultaneous callers share one ping.
    inFlight ??= run().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

export type HealthBody = {
  status: "ok" | "error";
  app: { commit: string | null };
  database: { status: "up"; latencyMs: number } | { status: "down" };
};

// The "down" body carries no error text, host or database version (CLAUDE.md rule 10).
export function toHealthResponse(
  result: HealthResult,
  commitSha: string | undefined,
): { status: 200 | 503; body: HealthBody } {
  const app = { commit: commitSha ? commitSha.slice(0, 7) : null };
  if (result.up) {
    return {
      status: 200,
      body: { status: "ok", app, database: { status: "up", latencyMs: result.latencyMs } },
    };
  }
  return { status: 503, body: { status: "error", app, database: { status: "down" } } };
}
