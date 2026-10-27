// Browser-side fetch wrapper. It exists so that every request made with it reports an expired
// session in one place (P19) instead of each screen handling 401 on its own.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    // The `details` of the error body (for example the productId of INSUFFICIENT_STOCK).
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// POST /api/auth/login also answers 401, but with INVALID_CREDENTIALS: that is a wrong password,
// not an ended session. Only UNAUTHENTICATED (see /api/me) means the session is gone.
export function isSessionExpired(status: number, code: string): boolean {
  return status === 401 && code === "UNAUTHENTICATED";
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const response = await fetchImpl(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.ok) return (response.status === 204 ? undefined : await response.json()) as T;

  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: unknown;
  } | null;
  const code = body?.code ?? "UNKNOWN";
  if (isSessionExpired(response.status, code)) listeners.forEach((listener) => listener());
  throw new ApiError(response.status, code, body?.message ?? "Terjadi kesalahan.", body?.details);
}
