"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
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
import { formatDateTimeWib } from "@/lib/format";
import { MovementDetailSheet } from "./movement-detail-sheet";
import {
  fetchLookups,
  fetchMovements,
  MOVEMENTS_QUERY_KEY,
  type MovementFilters,
} from "./movement-api";
import type { InitialMovementFilters } from "./movement-search-params";
import { dayBoundsWib, formatDelta, TYPE_LABEL } from "./movement-labels";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const NO_FILTER = { productId: "", warehouseId: "", type: "", from: "", to: "" };

// S10. The server already narrows rows to the user's warehouses; the filters only narrow further.
// Export (CSV and XLSX) arrives with E13 and is not offered here.
export function MovementList({ initial }: { initial?: InitialMovementFilters }) {
  const [form, setForm] = useState({ ...NO_FILTER, ...initial });
  const [openId, setOpenId] = useState<string | null>(null);
  const filters: MovementFilters = {
    productId: form.productId,
    warehouseId: form.warehouseId,
    type: form.type,
    ...dayBoundsWib(form.from, form.to),
  };
  const lookups = useQuery({
    queryKey: [...MOVEMENTS_QUERY_KEY, "lookups"],
    queryFn: fetchLookups,
    retry: false,
  });
  const list = useInfiniteQuery({
    queryKey: [...MOVEMENTS_QUERY_KEY, filters],
    queryFn: ({ pageParam }) => fetchMovements(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const warehouseName = useMemo(
    () => new Map(lookups.data?.warehouses.map((w) => [w.id, w.name])),
    [lookups.data],
  );
  const product = useMemo(
    () => new Map(lookups.data?.products.map((p) => [p.id, p])),
    [lookups.data],
  );
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const filtered = Object.values(form).some(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Riwayat pergerakan stok</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Log kronologis penerimaan, penyesuaian, mutasi, dan impor stok.
        </p>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Dari tanggal
          <Input
            type="date"
            value={form.from}
            max={form.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Sampai tanggal
          <Input
            type="date"
            value={form.to}
            min={form.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tipe
          <select
            className={selectClass}
            value={form.type}
            onChange={(e) => set({ type: e.target.value })}
          >
            <option value="">Semua tipe</option>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Produk
          <select
            className={selectClass}
            value={form.productId}
            onChange={(e) => set({ productId: e.target.value })}
          >
            <option value="">Semua produk</option>
            {lookups.data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Gudang
          <select
            className={selectClass}
            value={form.warehouseId}
            onChange={(e) => set({ warehouseId: e.target.value })}
          >
            <option value="">Semua gudang</option>
            {lookups.data?.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button variant="outline" disabled={!filtered} onClick={() => setForm(NO_FILTER)}>
            Hapus filter
          </Button>
        </div>
      </div>

      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && (
        <EmptyState
          message={
            filtered
              ? "Tidak ada pergerakan yang cocok dengan filter."
              : "Belum ada pergerakan stok."
          }
        />
      )}
      {rows.length > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu (WIB)</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>Gudang</TableHead>
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
                      <TableCell className="font-medium">{item?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {warehouseName.get(row.warehouseId) ?? "—"}
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
          <div className="flex flex-col items-center gap-2">
            {list.hasNextPage && (
              <Button
                variant="outline"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? "Memuat..." : "Muat lebih banyak"}
              </Button>
            )}
            {list.isFetchNextPageError && <ErrorBanner onRetry={() => void list.fetchNextPage()} />}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden />
              Riwayat tidak dapat diubah
            </p>
          </div>
        </>
      )}

      <MovementDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
