import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorBannerProps = {
  message?: string;
  /** Re-runs the failed request. The "Coba lagi" button only shows when this is given. */
  onRetry?: () => void;
};

/** Functional spec: "Error: a red banner with a 'Coba lagi' button". */
export function ErrorBanner({
  message = "Terjadi kesalahan. Silakan coba lagi.",
  onRetry,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-xl border border-destructive-border bg-destructive-soft px-4 py-3 text-destructive"
    >
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <p className="flex-1 text-sm font-medium">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}
