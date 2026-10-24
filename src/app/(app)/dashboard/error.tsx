"use client";

import { ErrorBanner } from "@/components/states/error-banner";

// Next.js passes `retry` (not `reset`) in this version; see the error.js docs.
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <ErrorBanner onRetry={retry} />;
}
