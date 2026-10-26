"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, PackagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/states/error-banner";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import {
  canReceiveStock,
  fetchReceiveOptions,
  receiveStock,
  RECEIVE_OPTIONS_KEY,
  STOCK_QUERY_KEY,
} from "./stock-api";
import {
  receiveErrorMessage,
  stockReceiveSchema,
  type StockReceiveInput,
  type StockReceiveValues,
} from "./stock-receive-schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected when opened from S06 (warehouse) or S08 (product). */
  warehouseId?: string;
  productId?: string;
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm aria-invalid:border-destructive";

// P04. Opened from S04, S06, S08 and S09.
export function StockReceiveDialog({ open, onOpenChange, warehouseId, productId }: Props) {
  const queryClient = useQueryClient();
  // A new key every time the form opens, kept until the receipt succeeds: a double click or a retry
  // after a timeout then sends the same key, and the server applies it once (BL14).
  const idempotencyKey = useRef("");
  const options = useQuery({
    queryKey: RECEIVE_OPTIONS_KEY,
    queryFn: fetchReceiveOptions,
    enabled: open,
    retry: false,
  });
  const form = useForm<StockReceiveInput, unknown, StockReceiveValues>({
    resolver: zodResolver(stockReceiveSchema),
    defaultValues: { warehouseId: "", productId: "", quantity: "", note: "" },
  });

  const warehouses = options.data?.warehouses ?? [];
  const products = options.data?.products ?? [];
  const onlyWarehouse = warehouses.length === 1 ? warehouses[0]!.id : "";

  useEffect(() => {
    if (!open) return;
    idempotencyKey.current = crypto.randomUUID();
  }, [open]);

  // Start fresh every time the dialog opens. The options may arrive later, so the select is set again
  // once they are loaded (a value with no matching <option> would show as empty).
  useEffect(() => {
    if (!open || !options.data) return;
    form.reset({
      warehouseId: warehouseId ?? onlyWarehouse,
      productId: productId ?? "",
      quantity: "",
      note: "",
    });
  }, [open, options.data, warehouseId, productId, onlyWarehouse, form]);

  const receive = useMutation({
    mutationFn: (values: StockReceiveValues) => receiveStock(idempotencyKey.current, values),
    onSuccess: async () => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY });
    },
    onError: (error) => {
      const view = receiveErrorMessage(error);
      if (view.field) form.setError(view.field, { message: view.message });
    },
  });

  const view = receive.isError ? receiveErrorMessage(receive.error) : null;
  const { errors } = form.formState;
  const chosenProduct = useWatch({ control: form.control, name: "productId" });
  const unit = products.find((product) => product.id === chosenProduct)?.unit;

  function handleOpenChange(next: boolean) {
    if (!next) receive.reset();
    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-135 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-heading text-lg font-bold">Terima barang</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Catat penambahan persediaan barang masuk langsung ke gudang.
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
              onSubmit={form.handleSubmit((values) => receive.mutate(values))}
              noValidate
              className="mt-5 space-y-4"
            >
              {view && !view.field && <ErrorBanner message={view.message} />}
              <div className="space-y-1.5">
                <label htmlFor="receive-warehouse" className="block text-sm font-semibold">
                  Gudang
                </label>
                <select
                  id="receive-warehouse"
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
                <label htmlFor="receive-product" className="block text-sm font-semibold">
                  Produk
                </label>
                <select
                  id="receive-product"
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
              <div className="space-y-1.5">
                <label htmlFor="receive-quantity" className="block text-sm font-semibold">
                  Jumlah diterima
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="receive-quantity"
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-44"
                    aria-invalid={!!errors.quantity}
                    {...form.register("quantity")}
                  />
                  {unit && (
                    <span className="text-sm font-medium text-muted-foreground">{unit}</span>
                  )}
                </div>
                {errors.quantity && (
                  <p className="text-sm text-destructive">{errors.quantity.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="receive-note" className="block text-sm font-semibold">
                  Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
                </label>
                <Input
                  id="receive-note"
                  autoComplete="off"
                  placeholder="Contoh: Penerimaan stok mingguan"
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
                <Button type="submit" disabled={receive.isPending || options.isPending}>
                  {receive.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Simpan penerimaan
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// The "Terima barang" button plus its dialog. Hidden for a role that cannot write stock (Viewer); the
// API refuses them anyway (403), this only avoids offering a button that cannot work.
export function ReceiveStockButton({
  warehouseId,
  productId,
  variant = "default",
}: Pick<Props, "warehouseId" | "productId"> & { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  if (!canReceiveStock(me.data?.user.role)) return null;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <PackagePlus aria-hidden />
        Terima barang
      </Button>
      <StockReceiveDialog
        open={open}
        onOpenChange={setOpen}
        warehouseId={warehouseId}
        productId={productId}
      />
    </>
  );
}
