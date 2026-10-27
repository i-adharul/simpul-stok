"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { formatDateTimeWib } from "@/lib/format";
import { MovementDetailSheet } from "./movement-detail-sheet";
import { fetchLookups, fetchMovements, MOVEMENTS_QUERY_KEY } from "./movement-api";
import { formatDelta, TYPE_LABEL } from "./movement-labels";

const PREVIEW_ROWS = 10;
type Scope = { warehouseId: string } | { productId: string };

// History block of S06 and S08: the newest rows of one warehouse or product. The server already
// narrows rows to the caller's warehouses. "Lihat semua" opens S10 with the same filter applied.
export function MovementHistorySection(scope: Scope) {
  const byWarehouse = "warehouseId" in scope;
  const [openId, setOpenId] = useState<string | null>(null);
  const filters = {
    warehouseId: "warehouseId" in scope ? scope.warehouseId : "",
    productId: "productId" in scope ? scope.productId : "",
    type: "",
  };
  const list = useQuery({
    queryKey: [...MOVEMENTS_QUERY_KEY, "section", filters],
    queryFn: () => fetchMovements(filters, null),
    retry: false,
  });
  const lookups = useQuery({
    queryKey: [...MOVEMENTS_QUERY_KEY, "lookups"],
    queryFn: fetchLookups,
    retry: false,
  });
  const warehouseName = useMemo(
    () => new Map(lookups.data?.warehouses.map((w) => [w.id, w.name])),
    [lookups.data],
  );
  const product = useMemo(
    () => new Map(lookups.data?.products.map((p) => [p.id, p])),
    [lookups.data],
  );
  const rows = list.data?.items.slice(0, PREVIEW_ROWS) ?? [];
  const seeAll = new URLSearchParams(
    byWarehouse ? { warehouseId: scope.warehouseId } : { productId: scope.productId },
  );

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="history-title" className="font-semibold">
          Riwayat pergerakan
        </h2>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/movements?${seeAll.toString()}`}>Lihat semua</Link>
        </Button>
      </div>
      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && <EmptyState message="Belum ada pergerakan stok." />}
      {rows.length > 0 && (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu (WIB)</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>{byWarehouse ? "Produk" : "Gudang"}</TableHead>
                <TableHead className="text-right">Perubahan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const item = product.get(row.productId);
                return (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(row.id)}
                  >
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTimeWib(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium hover:underline"
                        onClick={() => setOpenId(row.id)}
                      >
                        {TYPE_LABEL[row.type]}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm">
                      {byWarehouse
                        ? (item?.name ?? "—")
                        : (warehouseName.get(row.warehouseId) ?? "—")}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium whitespace-nowrap ${row.quantityDelta < 0 ? "text-destructive" : "text-emerald-700"}`}
                    >
                      {formatDelta(row.quantityDelta)} {item?.unit}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <MovementDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
