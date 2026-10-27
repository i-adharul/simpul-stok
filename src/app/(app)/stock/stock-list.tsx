"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackagePlus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Pagination } from "@/components/pagination";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { clampPage } from "@/lib/pagination";
import { formatNumber } from "@/lib/format";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { StockReceiveDialog } from "./stock-receive-dialog";
import {
  canReceiveStock,
  fetchStockPage,
  fetchWarehouseOptions,
  STOCK_PAGE_SIZE,
  STOCK_QUERY_KEY,
  STOCK_WAREHOUSES_KEY,
  type StockFilters,
  type StockRow,
  type StockStatus,
} from "./stock-api";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const STATUS_LABEL: Record<StockStatus, string> = { OUT: "Habis", LOW: "Menipis", OK: "Cukup" };
const STATUS_CLASS: Record<StockStatus, string> = {
  OUT: "bg-destructive/10 text-destructive",
  LOW: "bg-amber-100 text-amber-800",
  OK: "bg-emerald-100 text-emerald-800",
};
// Row target of P04 / P05: the pair the button was pressed on.
type Target = { kind: "receive" | "adjust"; row: StockRow } | null;

// S09. The server narrows rows to the user's warehouses. Only pairs that have a stock row are listed;
// the strip for pairs without a row is drawn in S06 and S08, where the warehouse list is known.
export function StockList() {
  const [warehouseId, setWarehouseId] = useState("");
  const [status, setStatus] = useState<StockStatus | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [requestedPage, setPage] = useState(1);
  const [target, setTarget] = useState<Target>(null);
  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const warehouses = useQuery({
    queryKey: STOCK_WAREHOUSES_KEY,
    queryFn: fetchWarehouseOptions,
    retry: false,
  });
  const filters: StockFilters = { warehouseId, q, status };
  const list = useQuery({
    queryKey: [...STOCK_QUERY_KEY, "summary", filters, requestedPage],
    queryFn: async () => {
      const result = await fetchStockPage(filters, requestedPage);
      // The last page may have emptied since the user opened it: load the last one instead.
      const last = clampPage(requestedPage, result.total, STOCK_PAGE_SIZE);
      return last !== requestedPage ? fetchStockPage(filters, last) : result;
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
  const canWrite = canReceiveStock(me.data?.user.role);
  const filtered = Boolean(warehouseId || status || q);
  const summary = list.data?.summary;
  const chips: { value: StockStatus | ""; label: string; count?: number }[] = [
    { value: "", label: "Semua", count: summary && summary.out + summary.low + summary.ok },
    { value: "OUT", label: STATUS_LABEL.OUT, count: summary?.out },
    { value: "LOW", label: STATUS_LABEL.LOW, count: summary?.low },
    { value: "OK", label: STATUS_LABEL.OK, count: summary?.ok },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ringkasan stok</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Stok terkini per gudang dan produk, lengkap dengan statusnya.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Gudang
          <select
            className={selectClass}
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua gudang</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Cari produk
          <Input
            type="search"
            placeholder="Nama atau SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2" role="group" aria-label="Status stok">
          {chips.map((chip) => (
            <Button
              key={chip.value || "all"}
              variant={status === chip.value ? "default" : "outline"}
              size="sm"
              aria-pressed={status === chip.value}
              onClick={() => {
                setStatus(chip.value);
                setPage(1);
              }}
            >
              {chip.label}
              {chip.count !== undefined && ` (${formatNumber(chip.count)})`}
            </Button>
          ))}
        </div>
      </div>

      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && list.data.total === 0 && (
        <EmptyState
          message={
            filtered
              ? "Tidak ada stok yang cocok dengan filter."
              : "Belum ada stok tercatat. Terima barang untuk memulai."
          }
          action={
            canWrite && !filtered ? (
              <Button variant="outline" asChild>
                <Link href="/products">Lihat produk</Link>
              </Button>
            ) : undefined
          }
        />
      )}
      {list.data && list.data.total > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gudang</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Batas minimum</TableHead>
                  <TableHead>Status</TableHead>
                  {canWrite && <TableHead className="text-right">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((row) => (
                  <TableRow key={`${row.warehouse.id}:${row.product.id}`}>
                    <TableCell>
                      <Link href={`/warehouses/${row.warehouse.id}`} className="hover:underline">
                        {row.warehouse.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/products/${row.product.id}`} className="hover:underline">
                        {row.product.name}
                      </Link>
                      {row.product.archived && (
                        <span className="ml-2 text-xs text-muted-foreground">(diarsipkan)</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.product.sku}</TableCell>
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
                    {canWrite && (
                      <TableCell className="space-x-2 text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Terima barang ${row.product.name}`}
                          disabled={row.product.archived}
                          onClick={() => setTarget({ kind: "receive", row })}
                        >
                          <PackagePlus aria-hidden />
                          Terima barang
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Sesuaikan stok ${row.product.name}`}
                          onClick={() => setTarget({ kind: "adjust", row })}
                        >
                          <SlidersHorizontal aria-hidden />
                          Sesuaikan stok
                        </Button>
                      </TableCell>
                    )}
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

      {canWrite && (
        <>
          <StockReceiveDialog
            open={target?.kind === "receive"}
            onOpenChange={(open) => !open && setTarget(null)}
            warehouseId={target?.row.warehouse.id}
            productId={target?.row.product.id}
          />
          <StockAdjustDialog
            open={target?.kind === "adjust"}
            onOpenChange={(open) => !open && setTarget(null)}
            warehouseId={target?.row.warehouse.id}
            productId={target?.row.product.id}
          />
        </>
      )}
    </div>
  );
}
