"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { Pagination } from "@/components/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { fetchStockPage, STOCK_PAGE_SIZE, STOCK_QUERY_KEY, type StockStatus } from "./stock-api";

const STATUS_LABEL: Record<StockStatus, string> = { OUT: "Habis", LOW: "Menipis", OK: "Cukup" };
const STATUS_CLASS: Record<StockStatus, string> = {
  OUT: "bg-destructive/10 text-destructive",
  LOW: "bg-amber-100 text-amber-800",
  OK: "bg-emerald-100 text-emerald-800",
};

type Scope = { warehouseId: string } | { productId: string };

// Stock block of S06 (per product in a warehouse) and S08 (per warehouse of a product). The same
// GET /api/stock as S09: the server narrows the rows to the caller's warehouses, so the numbers
// already respect warehouse access. Only pairs that have a stock row are listed.
export function StockSection(scope: Scope) {
  const byWarehouse = "warehouseId" in scope;
  const [page, setPage] = useState(1);
  const filters = {
    warehouseId: "warehouseId" in scope ? scope.warehouseId : "",
    productId: "productId" in scope ? scope.productId : "",
    q: "",
    status: "" as const,
  };
  const list = useQuery({
    queryKey: [...STOCK_QUERY_KEY, "section", filters, page],
    queryFn: () => fetchStockPage(filters, page),
    placeholderData: keepPreviousData,
    retry: false,
  });

  return (
    <section aria-labelledby="stock-title" className="flex flex-col gap-3">
      <h2 id="stock-title" className="font-semibold">
        {byWarehouse ? "Stok di gudang ini" : "Stok per gudang"}
      </h2>
      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && list.data.total === 0 && (
        <EmptyState
          message={
            byWarehouse
              ? "Belum ada stok tercatat di gudang ini."
              : "Produk ini belum punya stok di gudang mana pun."
          }
        />
      )}
      {list.data && list.data.total > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{byWarehouse ? "Produk" : "Gudang"}</TableHead>
                  {byWarehouse && <TableHead>SKU</TableHead>}
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Batas minimum</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((row) => (
                  <TableRow key={`${row.warehouse.id}:${row.product.id}`}>
                    <TableCell className="font-medium">
                      <Link
                        href={
                          byWarehouse
                            ? `/products/${row.product.id}`
                            : `/warehouses/${row.warehouse.id}`
                        }
                        className="hover:underline"
                      >
                        {byWarehouse ? row.product.name : row.warehouse.name}
                      </Link>
                      {byWarehouse && row.product.archived && (
                        <span className="ml-2 text-xs text-muted-foreground">(diarsipkan)</span>
                      )}
                    </TableCell>
                    {byWarehouse && (
                      <TableCell className="font-mono text-xs">{row.product.sku}</TableCell>
                    )}
                    <TableCell className="text-right font-medium whitespace-nowrap">
                      {formatNumber(row.quantity)} {row.product.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(row.product.minStock)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={list.data.page}
            pageSize={STOCK_PAGE_SIZE}
            total={list.data.total}
            noun="baris stok"
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}
