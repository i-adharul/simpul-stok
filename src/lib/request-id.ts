export const REQUEST_ID_HEADER = "x-request-id";

// A client may send its own ID so one trace can span systems. It lands in log lines, so it is
// accepted only in a safe shape; anything else (newlines, quotes, huge values) is replaced.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming && VALID_REQUEST_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}
