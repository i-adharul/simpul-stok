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
import { ApiError } from "@/lib/api-client";
import {
  warehouseFormSchema,
  type WarehouseFormInput,
  type WarehouseFormValues,
} from "./warehouse-form-schema";
import { saveWarehouse, WAREHOUSES_QUERY_KEY, type Warehouse } from "./warehouse-api";

const EMPTY: WarehouseFormInput = { code: "", name: "", address: "" };

function initialValues(warehouse: Warehouse | null): WarehouseFormInput {
  return warehouse
    ? { code: warehouse.code, name: warehouse.name, address: warehouse.address ?? "" }
    : EMPTY;
}

type Props = {
  /** null creates a new warehouse; a warehouse edits it. */
  warehouse: Warehouse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// P01. Opened from S05 (and later S06).
export function WarehouseFormDialog({ warehouse, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const form = useForm<WarehouseFormInput, unknown, WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: initialValues(warehouse),
  });

  // Start fresh every time the dialog opens, for the warehouse that was chosen.
  useEffect(() => {
    if (open) form.reset(initialValues(warehouse));
  }, [open, warehouse, form]);

  const save = useMutation({
    mutationFn: (values: WarehouseFormValues) => saveWarehouse(warehouse?.id ?? null, values),
    onSuccess: async () => {
      // The list reloads after the popup closes (acceptance criteria).
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
    onError: (error) => {
      // The server is the authority: a duplicate code (409) belongs under the code input.
      if (error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("code", { message: error.message });
      }
    },
  });

  const handled = save.error instanceof ApiError && save.error.code === "CONFLICT";
  const { errors } = form.formState;
  const editing = warehouse !== null;

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
                {editing ? "Ubah gudang" : "Tambah gudang"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {editing
                  ? "Perbarui kode, nama, atau alamat gudang."
                  : "Daftarkan lokasi fisik baru untuk penyimpanan dan mutasi stok."}
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
              <ErrorBanner message="Gudang belum dapat disimpan. Silakan coba lagi." />
            )}
            <div className="space-y-1.5">
              <label htmlFor="code" className="block text-sm font-semibold">
                Kode gudang
              </label>
              <Input
                id="code"
                autoComplete="off"
                aria-invalid={!!errors.code}
                {...form.register("code")}
              />
              {errors.code ? (
                <p className="text-sm text-destructive">{errors.code.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Kode unik di organisasi (contoh: GD-04)
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-semibold">
                Nama gudang
              </label>
              <Input
                id="name"
                autoComplete="off"
                aria-invalid={!!errors.name}
                {...form.register("name")}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="address" className="block text-sm font-semibold">
                Alamat <span className="font-normal text-muted-foreground">(opsional)</span>
              </label>
              <Input
                id="address"
                autoComplete="off"
                aria-invalid={!!errors.address}
                {...form.register("address")}
              />
              {errors.address && (
                <p className="text-sm text-destructive">{errors.address.message}</p>
              )}
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
