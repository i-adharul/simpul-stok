"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/states/error-banner";
import {
  PRODUCT_UNITS,
  productFormSchema,
  skuConflictMessage,
  type ProductFormInput,
  type ProductFormValues,
} from "./product-form-schema";
import { PRODUCTS_QUERY_KEY, saveProduct, type Product } from "./product-api";

const EMPTY: ProductFormInput = { sku: "", name: "", unit: "pcs", minStock: "0" };

function initialValues(product: Product | null): ProductFormInput {
  return product
    ? {
        sku: product.sku,
        name: product.name,
        unit: product.unit as ProductFormInput["unit"],
        minStock: String(product.minStock),
      }
    : EMPTY;
}

type Props = {
  /** null creates a new product; a product edits it. */
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// P02. Opened from S07 (and later S08).
export function ProductFormDialog({ product, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: initialValues(product),
  });

  // Start fresh every time the dialog opens, for the product that was chosen.
  useEffect(() => {
    if (open) form.reset(initialValues(product));
  }, [open, product, form]);

  const save = useMutation({
    mutationFn: (values: ProductFormValues) => saveProduct(product?.id ?? null, values),
    onSuccess: async () => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
    onError: (error) => {
      const message = skuConflictMessage(error);
      if (message) form.setError("sku", { message });
    },
  });

  const handled = skuConflictMessage(save.error) !== null;
  const { errors } = form.formState;
  const editing = product !== null;

  function handleOpenChange(next: boolean) {
    if (!next) save.reset();
    onOpenChange(next);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-120 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-heading text-lg font-bold">
                {editing ? "Ubah produk" : "Tambah produk"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {editing
                  ? "Perbarui SKU, nama, satuan, atau batas stok minimum."
                  : "Daftarkan SKU baru ke dalam katalog produk organisasi."}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Tutup"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <form
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            noValidate
            className="mt-5 space-y-4"
          >
            {save.isError && !handled && (
              <ErrorBanner message="Produk belum dapat disimpan. Silakan coba lagi." />
            )}
            <div className="space-y-1.5">
              <label htmlFor="sku" className="block text-sm font-semibold">
                SKU
              </label>
              <Input
                id="sku"
                autoComplete="off"
                className="font-mono"
                aria-invalid={!!errors.sku}
                {...form.register("sku")}
              />
              {errors.sku ? (
                <p className="text-sm text-destructive">{errors.sku.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Unik di organisasi, huruf besar tanpa spasi (contoh: GL-001)
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-semibold">
                Nama produk
              </label>
              <Input
                id="name"
                autoComplete="off"
                aria-invalid={!!errors.name}
                {...form.register("name")}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="unit" className="block text-sm font-semibold">
                  Satuan
                </label>
                <select
                  id="unit"
                  aria-invalid={!!errors.unit}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  {...form.register("unit")}
                >
                  {PRODUCT_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>
                      {unit.label}
                    </option>
                  ))}
                </select>
                {errors.unit && <p className="text-sm text-destructive">{errors.unit.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="minStock" className="block text-sm font-semibold">
                  Batas stok minimum
                </label>
                <Input
                  id="minStock"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={!!errors.minStock}
                  {...form.register("minStock")}
                />
                {errors.minStock && (
                  <p className="text-sm text-destructive">{errors.minStock.message}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Batal
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Simpan
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
