"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/states/error-banner";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import {
  adjustStock,
  canAdjustStock,
  fetchReceiveOptions,
  RECEIVE_OPTIONS_KEY,
  STOCK_QUERY_KEY,
} from "./stock-api";
import {
  ADJUST_REASON_LABELS,
  adjustErrorMessage,
  stockAdjustSchema,
  type StockAdjustInput,
  type StockAdjustValues,
} from "./stock-adjust-schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected when opened from S06 (warehouse) or S08 (product). */
  warehouseId?: string;
  productId?: string;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm aria-invalid:border-destructive";

const emptyValues = (warehouseId: string, productId: string): StockAdjustInput => ({
  warehouseId,
  productId,
  mode: "SET",
  value: "",
  reason: "" as StockAdjustInput["reason"],
  note: "",
});

// P05. Opened from S04, S06 and S09 (S09 does not exist yet).
export function StockAdjustDialog({ open, onOpenChange, warehouseId, productId }: Props) {
  const queryClient = useQueryClient();
  // A new key every time the form opens, kept until the adjustment succeeds (BL14), as in P04.
  const idempotencyKey = useRef("");
  // The same warehouse and product lists as P04 (one cache entry).
  const options = useQuery({
    queryKey: RECEIVE_OPTIONS_KEY,
    queryFn: fetchReceiveOptions,
    enabled: open,
    retry: false,
  });
  const form = useForm<StockAdjustInput, unknown, StockAdjustValues>({
    resolver: zodResolver(stockAdjustSchema),
    defaultValues: emptyValues("", ""),
  });

  const warehouses = options.data?.warehouses ?? [];
  const products = options.data?.products ?? [];
  const onlyWarehouse = warehouses.length === 1 ? warehouses[0]!.id : "";

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = crypto.randomUUID();
  }, [open]);

  // Start fresh every time the dialog opens; the select is set again once the options are loaded.
  useEffect(() => {
    if (!open || !options.data) return;
    form.reset(emptyValues(warehouseId ?? onlyWarehouse, productId ?? ""));
  }, [open, options.data, warehouseId, productId, onlyWarehouse, form]);

  const adjust = useMutation({
    mutationFn: (values: StockAdjustValues) => adjustStock(idempotencyKey.current, values),
    onSuccess: async () => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    },
    onError: (error) => {
      const view = adjustErrorMessage(error);
      if (view.field) form.setError(view.field, { message: view.message });
    },
  });

  const view = adjust.isError ? adjustErrorMessage(adjust.error) : null;
  const { errors } = form.formState;
  const chosenProduct = useWatch({ control: form.control, name: "productId" });
  const mode = useWatch({ control: form.control, name: "mode" });
  const unit = products.find((product) => product.id === chosenProduct)?.unit;

  function handleOpenChange(next: boolean) {
    if (!next) adjust.reset();
    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-135 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-heading text-lg font-bold">Sesuaikan stok</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Koreksi jumlah stok di gudang, misalnya setelah stok opname atau barang rusak.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Tutup"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {options.isError ? (
            <div className="mt-5">
              <ErrorBanner onRetry={() => void options.refetch()} />
            </div>
          ) : (
            <form
              onSubmit={form.handleSubmit((values) => adjust.mutate(values))}
              noValidate
              className="mt-5 space-y-4"
            >
              {view && !view.field && <ErrorBanner message={view.message} />}
              <div className="space-y-1.5">
                <label htmlFor="adjust-warehouse" className="block text-sm font-semibold">
                  Gudang
                </label>
                <select
                  id="adjust-warehouse"
                  aria-invalid={!!errors.warehouseId}
                  disabled={options.isPending}
                  className={selectClass}
                  {...form.register("warehouseId")}
                >
                  <option value="">Pilih gudang</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
                {errors.warehouseId && (
                  <p className="text-sm text-destructive">{errors.warehouseId.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adjust-product" className="block text-sm font-semibold">
                  Produk
                </label>
                <select
                  id="adjust-product"
                  aria-invalid={!!errors.productId}
                  disabled={options.isPending}
                  className={selectClass}
                  {...form.register("productId")}
                >
                  <option value="">Pilih produk</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </option>
                  ))}
                </select>
                {errors.productId && (
                  <p className="text-sm text-destructive">{errors.productId.message}</p>
                )}
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-semibold">Cara penyesuaian</legend>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" value="SET" {...form.register("mode")} />
                    Stok baru
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" value="DELTA" {...form.register("mode")} />
                    Selisih
                  </label>
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <label htmlFor="adjust-value" className="block text-sm font-semibold">
                  {mode === "SET" ? "Stok baru" : "Selisih (+ tambah, - kurang)"}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="adjust-value"
                    inputMode={mode === "SET" ? "numeric" : "text"}
                    autoComplete="off"
                    className="w-44"
                    aria-invalid={!!errors.value}
                    {...form.register("value")}
                  />
                  {unit && (
                    <span className="text-sm font-medium text-muted-foreground">{unit}</span>
                  )}
                </div>
                {errors.value && <p className="text-sm text-destructive">{errors.value.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adjust-reason" className="block text-sm font-semibold">
                  Alasan
                </label>
                <select
                  id="adjust-reason"
                  aria-invalid={!!errors.reason}
                  className={selectClass}
                  {...form.register("reason")}
                >
                  <option value="">Pilih alasan</option>
                  {Object.entries(ADJUST_REASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {errors.reason && (
                  <p className="text-sm text-destructive">{errors.reason.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="adjust-note" className="block text-sm font-semibold">
                  Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  id="adjust-note"
                  autoComplete="off"
                  placeholder="Contoh: Hitung ulang akhir bulan"
                  aria-invalid={!!errors.note}
                  {...form.register("note")}
                />
                {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Batal
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={adjust.isPending || options.isPending}>
                  {adjust.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Simpan penyesuaian
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The "Sesuaikan stok" button plus its dialog. Hidden for a role that cannot write stock (Viewer); the
// API refuses them anyway (403).
export function AdjustStockButton({
  warehouseId,
  productId,
  variant = "outline",
}: Pick<Props, "warehouseId" | "productId"> & { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  if (!canAdjustStock(me.data?.user.role)) return null;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden />
        Sesuaikan stok
      </Button>
      <StockAdjustDialog
        open={open}
        onOpenChange={setOpen}
        warehouseId={warehouseId}
        productId={productId}
      />
    </>
  );
}
