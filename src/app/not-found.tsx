import Link from "next/link";
import { AppShell } from "@/components/app-shell/app-shell";
import { ErrorPage } from "@/components/states/error-page";
import { buttonVariants } from "@/components/ui/button";
import { getServerUser } from "@/modules/platform/server-session";

// Rendered inside the root layout, which has no shell. Logged in: show the app shell and link to
// S04. Logged out: no shell (it would call /api/me and trigger P19) and link to S01.
export default async function NotFound() {
  const loggedIn = Boolean(await getServerUser());
  const page = (
    <ErrorPage
      status={404}
      actions={
        <Link href={loggedIn ? "/dashboard" : "/login"} className={buttonVariants()}>
          {loggedIn ? "Ke dashboard" : "Ke halaman masuk"}
        </Link>
      }
    />
  );
  if (loggedIn) return <AppShell>{page}</AppShell>;
  return <main className="p-4 md:p-8">{page}</main>;
}
