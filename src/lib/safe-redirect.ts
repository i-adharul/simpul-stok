// The login response carries redirectTo. It is only followed when it is a path inside this app,
// so a tampered response can never send the user to another site (open redirect).
export function safeRedirectPath(target: unknown, fallback = "/dashboard"): string {
  if (typeof target !== "string") return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  return target;
}
