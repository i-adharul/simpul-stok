"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionExpiredDialog } from "@/components/session/session-expired-dialog";

export function Providers({ children }: { children: ReactNode }) {
  // Created once per browser tab; a module-level client would be shared between server requests.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <SessionExpiredDialog />
    </QueryClientProvider>
  );
}
