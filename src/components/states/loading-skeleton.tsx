import { Skeleton } from "@/components/ui/skeleton";

type LoadingSkeletonProps = { rows?: number };

/** Placeholder shown while a list or table loads (functional spec: "Loading: a skeleton"). */
export function LoadingSkeleton({ rows = 5 }: LoadingSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-label="Memuat data" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-48" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
      <span className="sr-only">Memuat data...</span>
    </div>
  );
}
