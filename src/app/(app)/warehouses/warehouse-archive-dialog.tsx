"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/states/error-banner";
import { ApiError } from "@/lib/api-client";
import { setWarehouseArchived, WAREHOUSES_QUERY_KEY, type Warehouse } from "./warehouse-api";

type Props = {
  /** The warehouse to archive (active) or restore (archived); null keeps the dialog closed. */
  warehouse: Warehouse | null;
  onClose: () => void;
};

// P03. The server is the authority: 409 means the warehouse still holds stock, shown as the blocked variant.
export function WarehouseArchiveDialog({ warehouse, onClose }: Props) {
  const queryClient = useQueryClient();
  const restoring = warehouse?.archivedAt != null;
  const change = useMutation({
    mutationFn: (target: Warehouse) => setWarehouseArchived(target.id, target.archivedAt != null),
    onSuccess: async () => {
      onClose();
      await queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
  });
  const blocked = change.error instanceof ApiError && change.error.code === "CONFLICT";

  function handleOpenChange(open: boolean) {
    if (open) return;
    change.reset();
    onClose();
  }

  return (
    <Dialog.Root open={warehouse !== null} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-120 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-heading text-lg font-bold">
              {blocked
                ? "Tidak dapat diarsipkan"
                : `${restoring ? "Pulihkan" : "Arsipkan"} gudang ${warehouse?.name ?? ""}?`}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Tutup"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            {blocked
              ? "Gudang ini masih memiliki stok. Kosongkan atau mutasikan seluruh stok sebelum mengarsipkan."
              : restoring
                ? "Gudang akan aktif kembali dan dapat menerima stok."
                : "Gudang yang diarsipkan tidak dapat lagi menerima atau mengeluarkan stok."}
          </Dialog.Description>
          {change.isError && !blocked && (
            <div className="mt-4">
              <ErrorBanner message="Perubahan belum dapat disimpan. Silakan coba lagi." />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            {blocked ? (
              <Dialog.Close asChild>
                <Button type="button">Mengerti</Button>
              </Dialog.Close>
            ) : (
              <>
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Batal
                  </Button>
                </Dialog.Close>
                <Button
                  type="button"
                  variant={restoring ? "default" : "destructive"}
                  disabled={change.isPending}
                  onClick={() => warehouse && change.mutate(warehouse)}
                >
                  {change.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  {restoring ? "Pulihkan" : "Arsipkan"}
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
