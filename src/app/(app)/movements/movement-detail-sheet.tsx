"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/states/error-banner";
import { ApiError } from "@/lib/api-client";
import { formatDateTimeWib } from "@/lib/format";
import { fetchMovement, MOVEMENTS_QUERY_KEY, type MovementDetail } from "./movement-api";
import { formatDelta, movementRoleLabel, REASON_LABEL, TYPE_LABEL } from "./movement-labels";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

// P13. A drawer, opened from S10 (and later S06, S08, S12). Read only: movements are immutable.
export function MovementDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: [...MOVEMENTS_QUERY_KEY, "detail", id],
    queryFn: () => fetchMovement(id!),
    enabled: id !== null,
    retry: false,
  });
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Detail pergerakan</SheetTitle>
          <SheetDescription>
            {detail.data ? TYPE_LABEL[detail.data.type] : "Memuat rincian pergerakan."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {detail.isPending && id !== null && <Skeleton className="h-48 w-full" />}
          {detail.isError && (
            <ErrorBanner
              message={
                detail.error instanceof ApiError && detail.error.status === 404
                  ? "Pergerakan tidak ditemukan."
                  : undefined
              }
              onRetry={() => void detail.refetch()}
            />
          )}
          {detail.data && <DetailBody row={detail.data} />}
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Data riwayat tercatat permanen dan tidak dapat diubah
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ row }: { row: MovementDetail }) {
  return (
    <>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">Jumlah pergerakan</p>
        <p
          className={`mt-1 text-3xl font-bold ${row.quantityDelta < 0 ? "text-destructive" : "text-emerald-700"}`}
        >
          {formatDelta(row.quantityDelta)}{" "}
          <span className="text-base font-semibold text-muted-foreground">{row.product.unit}</span>
        </p>
      </div>
      <dl className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <Field label="Produk">
          <p className="font-semibold">{row.product.name}</p>
          <p className="text-xs text-muted-foreground">SKU {row.product.sku}</p>
        </Field>
        <Field label="Gudang">
          <p className="font-medium">{row.warehouse.name}</p>
          {row.transfer && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {row.transfer.fromWarehouse.name ?? "—"} <ArrowRight className="size-3" aria-hidden />{" "}
              {row.transfer.toWarehouse.name ?? "—"}
            </p>
          )}
        </Field>
        <Field label="Waktu pencatatan">{formatDateTimeWib(row.createdAt)}</Field>
        <Field label="Dibuat oleh">
          {row.createdBy ? (
            <>
              <span className="font-medium">{row.createdBy.name}</span>{" "}
              <span className="rounded border px-1.5 text-xs text-muted-foreground">
                {movementRoleLabel(row.createdBy.role)}
              </span>
            </>
          ) : (
            "—"
          )}
        </Field>
        {row.reason && <Field label="Alasan">{REASON_LABEL[row.reason]}</Field>}
        {row.note && <Field label="Catatan">{row.note}</Field>}
      </dl>
      {row.transfer && (
        <Link
          href={`/transfers/${row.transfer.id}`}
          className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm hover:border-primary"
        >
          <span>
            <span className="block text-xs text-muted-foreground">Terkait mutasi stok</span>
            <span className="font-mono font-bold">{row.transfer.code}</span>
          </span>
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </>
  );
}
