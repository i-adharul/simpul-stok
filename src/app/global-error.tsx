"use client";

import "./globals.css";
import { ErrorPage } from "@/components/states/error-page";
import { Button } from "@/components/ui/button";

// Replaces the root layout when it fails, so it must bring its own <html> and <body>.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="id">
      <body className="min-h-full p-4 font-sans md:p-8">
        <ErrorPage status={500} actions={<Button onClick={retry}>Muat ulang halaman</Button>} />
      </body>
    </html>
  );
}
