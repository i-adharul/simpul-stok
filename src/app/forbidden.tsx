import Link from "next/link";
import { ErrorPage } from "@/components/states/error-page";
import { buttonVariants } from "@/components/ui/button";

// Shown when forbidden() is called (needs experimental.authInterrupts). Only logged-in users
// can be forbidden, so the way back is always S04.
export default function Forbidden() {
  return (
    <main className="p-4 md:p-8">
      <ErrorPage
        status={403}
        actions={
          <Link href="/dashboard" className={buttonVariants()}>
            Ke dashboard
          </Link>
        }
      />
    </main>
  );
}
