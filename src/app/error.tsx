"use client";

import Link from "next/link";
import { ErrorPage } from "@/components/states/error-page";
import { Button, buttonVariants } from "@/components/ui/button";

// The error object is deliberately ignored: showing its message could leak internals (BL29).
// "/" sends a logged-in user to S04 and a logged-out one to S01, so no session check is needed here.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="p-4 md:p-8">
      <ErrorPage
        status={500}
        actions={
          <>
            <Button onClick={retry}>Muat ulang halaman</Button>
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              Ke beranda
            </Link>
          </>
        }
      />
    </main>
  );
}
