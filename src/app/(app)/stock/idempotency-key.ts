export type Attempt = { key: string; payload: string };

// Order-independent text form of a payload, so two equal payloads compare equal.
function fingerprint(payload: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Decides the Idempotency-Key for the next submit of a stock dialog (BL14).
 * The server replays the first answer for a key without comparing the body, so a key may only be
 * reused for a retry of the SAME payload as the last attempt. Any difference gets a fresh key,
 * including changing a field and changing it back (only the last attempt counts).
 * `previous` is null on the first attempt after the dialog opens.
 */
export function nextIdempotencyKey(
  previous: Attempt | null,
  payload: Record<string, unknown>,
  newKey: () => string = () => crypto.randomUUID(),
): Attempt {
  const next = fingerprint(payload);
  if (previous && previous.payload === next) return previous;
  return { key: newKey(), payload: next };
}
