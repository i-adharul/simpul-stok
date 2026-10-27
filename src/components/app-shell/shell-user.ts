import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api-client";

// Shape of GET /api/me (docs/04_API_Spec.md). Declared here because the server type pulls in Prisma.
export type MeResponse = {
  user: { id: string; name: string; email: string; role: string };
  organization: { id: string; name: string; slug: string; status: string } | null;
};

export const ME_QUERY_KEY = ["me"] as const;

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  OWNER: "Owner",
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};

export function roleLabel(role: string): string {
  // hasOwn, not `??`: "constructor" would otherwise resolve to Object.prototype.constructor.
  return Object.hasOwn(ROLE_LABELS, role) ? ROLE_LABELS[role] : role;
}

// A platform admin has no organization (docs/04_API_Spec.md).
export function organizationLabel(me: MeResponse): string {
  return me.organization?.name ?? "Simpul Platform";
}

/** Up to two letters: first letters of the first and last word of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me");
}

// Ends the session on the server, then drops every cached query so the next user on this browser
// never sees the previous user's data, then goes to S01.
export async function logout(
  queryClient: Pick<QueryClient, "clear">,
  navigate: (path: string) => void,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await apiFetch<void>("/api/auth/logout", { method: "POST" }, fetchImpl);
  queryClient.clear();
  navigate("/login");
}
