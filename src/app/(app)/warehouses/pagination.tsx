import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { pageCount, pageWindow } from "@/lib/pagination";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

/** Numbered pages with the total (functional spec, Design decisions: Pagination). */
export function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const last = pageCount(total, pageSize);
  return (
    <nav aria-label="Halaman" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Total {formatNumber(total)} gudang</p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Sebelumnya
        </Button>
        {pageWindow(page, last).map((item, index) =>
          item === null ? (
            <span key={`gap-${index}`} className="px-1 text-muted-foreground" aria-hidden>
              ...
            </span>
          ) : (
            <Button
              key={item}
              variant={item === page ? "default" : "outline"}
              size="sm"
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ),
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya
        </Button>
      </div>
    </nav>
  );
}
