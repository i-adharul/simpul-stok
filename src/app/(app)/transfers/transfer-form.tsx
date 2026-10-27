"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { ArrowRight, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
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
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { formatNumber } from "@/lib/format";
import {
  canReceiveStock,
  fetchAll,
  fetchWarehouseOptions,
  STOCK_QUERY_KEY,
  STOCK_WAREHOUSES_KEY,
} from "../stock/stock-api";
import { nextIdempotencyKey, type Attempt } from "../stock/idempotency-key";
import type { Product } from "../products/product-api";
import {
  createTransfer,
  fetchSourceStock,
  fetchTransfer,
  fetchTransferDestinations,
  sourceStockKey,
  transferKey,
  TRANSFER_DESTINATIONS_KEY,
  TRANSFER_PRODUCTS_KEY,
} from "./transfer-api";
import {
  MAX_TRANSFER_ITEMS,
  transferErrorMessage,
  validateDraft,
  type DraftErrors,
  type DraftRow,
  type TransferErrorView,
  type TransferPayload,
} from "./transfer-schema";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm aria-invalid:border-destructive";
const noErrors: DraftErrors = { rows: {} };

// S11 with P11. The draft lives in React state only (nothing is stored); leaving the page drops it.
// `copyId` pre-fills the form from S12 ("Salin mutasi").
export function TransferForm({ copyId }: { copyId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const allowed = canReceiveStock(me.data?.user.role);

  const sources = useQuery({
    queryKey: STOCK_WAREHOUSES_KEY,
    queryFn: fetchWarehouseOptions,
    enabled: allowed,
    retry: false,
  });
  const destinations = useQuery({
    queryKey: TRANSFER_DESTINATIONS_KEY,
    queryFn: fetchTransferDestinations,
    enabled: allowed,
    retry: false,
  });
  const products = useQuery({
    queryKey: TRANSFER_PRODUCTS_KEY,
    queryFn: () => fetchAll<Product>("/api/products"),
    enabled: allowed,
    retry: false,
  });
  const copy = useQuery({
    queryKey: transferKey(copyId ?? ""),
    queryFn: () => fetchTransfer(copyId!),
    enabled: allowed && !!copyId,
    retry: false,
  });

  const [fromWarehouseId, setFrom] = useState("");
  const [toWarehouseId, setTo] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<DraftErrors>(noErrors);
  const [serverRowErrors, setServerRowErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<TransferErrorView | null>(null);
  const [review, setReview] = useState<TransferPayload | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  // One key per opened form; it changes only when the payload changes (BL14).
  const lastAttempt = useRef<Attempt | null>(null);

  const available = useQuery({
    queryKey: sourceStockKey(fromWarehouseId),
    queryFn: () => fetchSourceStock(fromWarehouseId),
    enabled: allowed && !!fromWarehouseId,
    retry: false,
  });

  const productList = useMemo(() => products.data ?? [], [products.data]);
  const productById = useMemo(() => new Map(productList.map((p) => [p.id, p])), [productList]);
  const sourceOptions = sources.data ?? [];
  const destinationOptions = (destinations.data ?? []).filter((w) => w.id !== fromWarehouseId);

  // Apply the copied transfer once, when everything it needs has loaded.
  const copied = useRef(false);
  useEffect(() => {
    if (copied.current || !copy.data || !sources.data || !destinations.data || !products.data)
      return;
    copied.current = true;
    const data = copy.data;
    const canUseSource = sources.data.some((w) => w.id === data.fromWarehouse.id);
    const kept = data.items.filter((item) => productById.has(item.productId));
    setFrom(canUseSource ? data.fromWarehouse.id : "");
    setTo(
      destinations.data.some((w) => w.id === data.toWarehouse.id) &&
        data.toWarehouse.id !== data.fromWarehouse.id
        ? data.toWarehouse.id
        : "",
    );
    setRows(kept.map((item) => ({ productId: item.productId, quantity: String(item.quantity) })));
    setNote(data.note ?? "");
    const notes: string[] = [];
    if (!canUseSource)
      notes.push("Anda tidak bisa mengirim dari gudang asal semula, pilih gudang asal.");
    if (kept.length < data.items.length) notes.push("Produk yang sudah diarsipkan tidak disalin.");
    setCopyNotice(notes.length > 0 ? notes.join(" ") : null);
  }, [copy.data, sources.data, destinations.data, products.data, productById]);

  const nameOf = (productId: string) => productById.get(productId)?.name;

  const send = useMutation({
    mutationFn: (payload: TransferPayload) => {
      lastAttempt.current = nextIdempotencyKey(lastAttempt.current, payload);
      return createTransfer(lastAttempt.current.key, payload);
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
      router.push(`/transfers/${created.id}`);
    },
    onError: (error) => {
      const view = transferErrorMessage(error, nameOf);
      setReview(null);
      if (view.productId) setServerRowErrors({ [view.productId]: view.message });
      else setFailure(view);
    },
  });

  function editRows(next: DraftRow[]) {
    setRows(next);
    setServerRowErrors({});
    setFailure(null);
  }

  function addProduct(product: Product) {
    if (rows.length >= MAX_TRANSFER_ITEMS || rows.some((r) => r.productId === product.id)) return;
    editRows([...rows, { productId: product.id, quantity: "" }]);
    setSearch("");
  }

  function startReview() {
    const result = validateDraft({ fromWarehouseId, toWarehouseId, rows, note });
    setErrors(result.ok ? noErrors : result.errors);
    setFailure(null);
    setServerRowErrors({});
    if (result.ok) setReview(result.payload);
  }

  if (me.data && !allowed) {
    return <ErrorBanner message="Anda tidak punya akses untuk membuat mutasi." />;
  }
  if (me.isPending || sources.isPending || destinations.isPending || products.isPending) {
    return me.isError ? <ErrorBanner onRetry={() => void me.refetch()} /> : <LoadingSkeleton />;
  }
  if (sources.isError || destinations.isError || products.isError) {
    return (
      <ErrorBanner
        onRetry={() => {
          void sources.refetch();
          void destinations.refetch();
          void products.refetch();
        }}
      />
    );
  }

  const term = search.trim().toLowerCase();
  const matches = term
    ? productList
        .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
        .slice(0, 8)
    : [];
  const full = rows.length >= MAX_TRANSFER_ITEMS;
  const warehouseName = (id: string, list: { id: string; name: string }[]) =>
    list.find((w) => w.id === id)?.name ?? "-";

  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        <span>Inventori</span>
        <ChevronRight className="size-4" aria-hidden />
        <span className="text-foreground">Buat mutasi</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Buat mutasi stok</h1>
          <p className="text-sm text-muted-foreground">
            Pindahkan stok antar gudang secara instan.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/movements">Kembali ke riwayat</Link>
        </Button>
      </div>

      {copyNotice && <ErrorBanner message={copyNotice} />}
      {failure && (
        <ErrorBanner message={failure.message} onRetry={failure.retry ? startReview : undefined} />
      )}

      <section className="grid gap-4 rounded-xl border bg-card p-6 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="transfer-from" className="block text-sm font-semibold">
            Gudang asal
          </label>
          <select
            id="transfer-from"
            className={selectClass}
            aria-invalid={!!errors.fromWarehouseId}
            value={fromWarehouseId}
            onChange={(event) => {
              setFrom(event.target.value);
              if (event.target.value === toWarehouseId) setTo("");
              setServerRowErrors({});
            }}
          >
            <option value="">Pilih gudang asal</option>
            {sourceOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {errors.fromWarehouseId && (
            <p className="text-sm text-destructive">{errors.fromWarehouseId}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="transfer-to" className="block text-sm font-semibold">
            Gudang tujuan
          </label>
          <select
            id="transfer-to"
            className={selectClass}
            aria-invalid={!!errors.toWarehouseId}
            value={toWarehouseId}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="">Pilih gudang tujuan</option>
            {destinationOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {errors.toWarehouseId && (
            <p className="text-sm text-destructive">{errors.toWarehouseId}</p>
          )}
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <label htmlFor="transfer-note" className="block text-sm font-semibold">
            Catatan mutasi <span className="font-normal text-muted-foreground">(opsional)</span>
          </label>
          <Input
            id="transfer-note"
            autoComplete="off"
            value={note}
            aria-invalid={!!errors.note}
            onChange={(event) => setNote(event.target.value)}
          />
          {errors.note && <p className="text-sm text-destructive">{errors.note}</p>}
        </div>
      </section>

      <section
        aria-labelledby="transfer-items"
        className="flex flex-col gap-3 rounded-xl border bg-card p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="transfer-items" className="font-semibold">
            Daftar item mutasi
          </h2>
          <span className="text-xs text-muted-foreground">
            {formatNumber(rows.length)} dari {MAX_TRANSFER_ITEMS} item
          </span>
        </div>
        <div className="relative">
          <label htmlFor="transfer-search" className="sr-only">
            Cari produk
          </label>
          <Input
            id="transfer-search"
            autoComplete="off"
            placeholder={full ? "Batas item tercapai" : "Cari produk atau SKU untuk ditambahkan"}
            disabled={full}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {term && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-md">
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">Produk tidak ditemukan.</li>
              )}
              {matches.map((product) => {
                const added = rows.some((r) => r.productId === product.id);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addProduct(product)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        {product.name} <span className="font-mono text-xs">({product.sku})</span>
                      </span>
                      {added ? (
                        <span className="text-xs text-muted-foreground">Sudah ditambahkan</span>
                      ) : (
                        <Plus className="size-4" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {errors.items && <p className="text-sm text-destructive">{errors.items}</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Tersedia di asal</TableHead>
                  <TableHead className="w-56">Jumlah</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const product = productById.get(row.productId);
                  const message = errors.rows[row.productId] ?? serverRowErrors[row.productId];
                  return (
                    <TableRow key={row.productId}>
                      <TableCell>
                        <div className="font-medium">{product?.name ?? "-"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {product?.sku}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {!fromWarehouseId
                          ? "-"
                          : available.data
                            ? `${formatNumber(available.data.get(row.productId) ?? 0)} ${product?.unit ?? ""}`
                            : "..."}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={`Jumlah ${product?.name ?? ""}`}
                            aria-invalid={!!message}
                            className="w-32"
                            value={row.quantity}
                            onChange={(event) =>
                              editRows(
                                rows.map((r) =>
                                  r.productId === row.productId
                                    ? { ...r, quantity: event.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                          <span className="text-sm text-muted-foreground">{product?.unit}</span>
                        </div>
                        {message && <p className="mt-1 text-sm text-destructive">{message}</p>}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Hapus ${product?.name ?? "produk"}`}
                          onClick={() =>
                            editRows(rows.filter((r) => r.productId !== row.productId))
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/movements">Batal</Link>
        </Button>
        <Button onClick={startReview}>Tinjau dan kirim</Button>
      </div>

      <Dialog.Root
        open={!!review}
        onOpenChange={(open) => !open && !send.isPending && setReview(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-135 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-heading text-lg font-bold">
                  Tinjau mutasi
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  Pastikan rincian mutasi sudah sesuai sebelum dikirim.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="Tutup"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            {review && (
              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Gudang asal</div>
                    <div className="font-semibold">
                      {warehouseName(review.fromWarehouseId, sourceOptions)}
                    </div>
                  </div>
                  <ArrowRight className="size-4 shrink-0" aria-hidden />
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Gudang tujuan</div>
                    <div className="font-semibold">
                      {warehouseName(review.toWarehouseId, destinations.data ?? [])}
                    </div>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produk</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {review.items.map((item) => {
                        const product = productById.get(item.productId);
                        return (
                          <TableRow key={item.productId}>
                            <TableCell>
                              <div className="font-medium">{product?.name}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {product?.sku}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-bold">
                              {formatNumber(item.quantity)} {product?.unit}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {review.note && (
                  <p className="text-sm text-muted-foreground">Catatan: {review.note}</p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    disabled={send.isPending}
                    onClick={() => setReview(null)}
                  >
                    Kembali
                  </Button>
                  <Button disabled={send.isPending} onClick={() => send.mutate(review)}>
                    {send.isPending && <Loader2 className="animate-spin" aria-hidden />}
                    Kirim mutasi
                  </Button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
