"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/states/error-banner";
import { PRODUCTS_QUERY_KEY, setProductArchived, type Product } from "./product-api";

type Props = {
  /** The product to archive (active) or restore (archived); null keeps the dialog closed. */
  product: Product | null;
  onClose: () => void;
};

// P03. Unlike a warehouse, a product with stock can be archived (BL09): it can still be adjusted to zero.
export function ProductArchiveDialog({ product, onClose }: Props) {
  const queryClient = useQueryClient();
  const restoring = product?.archivedAt != null;
  const change = useMutation({
    mutationFn: (target: Product) => setProductArchived(target.id, target.archivedAt != null),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
    },
  });

  function handleOpenChange(open: boolean) {
    if (open) return;
    change.reset();
    onClose();
  }

  return (
    <Dialog.Root open={product !== null} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-120 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-heading text-lg font-bold">
              {`${restoring ? "Pulihkan" : "Arsipkan"} produk ${product?.name ?? ""}?`}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Tutup"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {restoring
              ? "Produk akan aktif kembali dan dapat dipakai untuk penerimaan, transfer, dan impor."
              : "Produk yang diarsipkan tidak dapat dipakai untuk penerimaan, transfer, dan impor. Riwayat pergerakan tetap tersimpan, dan sisa stok masih dapat disesuaikan."}
          </Dialog.Description>
          {change.isError && (
            <div className="mt-4">
              <ErrorBanner message="Perubahan belum dapat disimpan. Silakan coba lagi." />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="outline">
                Batal
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant={restoring ? "default" : "destructive"}
              disabled={change.isPending}
              onClick={() => product && change.mutate(product)}
            >
              {change.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {restoring ? "Pulihkan" : "Arsipkan"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
