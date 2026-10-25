import { cookies } from "next/headers";
import { env } from "../../lib/env";
import { db } from "../../lib/db";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { SESSION_COOKIE_NAME } from "./session";

// For server components (pages and layouts), which have no Request object. Same validation as
// GET /api/me, so a page and the API never disagree about who is logged in.
export async function getServerUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const request = new Request("http://internal/", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  return getCurrentUser(db, env.SESSION_SECRET, request);
}
