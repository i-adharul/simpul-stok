"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, CircleCheck, Copy, List } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ApiError } from "@/lib/api-client";
import { formatDateTimeWib, formatNumber } from "@/lib/format";
import { MovementDetailSheet } from "../movements/movement-detail-sheet";
import { movementRoleLabel } from "../movements/movement-labels";
import {
  fetchTransfer,
  transferKey,
  type TransferDetailData,
  type TransferWarehouse,
} from "./transfer-api";

// S12. A completed transfer: header, both warehouses, items, note and the movement flow.
export function TransferDetail({ id }: { id: string }) {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const query = useQuery({
    queryKey: transferKey(id),
    queryFn: () => fetchTransfer(id),
    retry: false,
  });
  // 404 covers a missing ID, another organization's ID and a transfer outside the user's warehouses.
  if (query.error instanceof ApiError && query.error.status === 404) notFound();
  // The Viewer never transfers (BL13), so the copy action is for Owner and Warehouse Admin only.
  const canCopy = me.data?.user.role === "OWNER" || me.data?.user.role === "WAREHOUSE_ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href="/movements" className="hover:underline">
            Riwayat
          </Link>
          <ChevronRight className="size-4" aria-hidden />
          <span className="font-mono text-foreground">{query.data?.code ?? "..."}</span>
        </nav>
        <div className="flex flex-wrap gap-2">
          {canCopy && query.data && (
            <Button variant="outline" asChild>
              <Link href={`/transfers/new?copy=${query.data.id}`}>
                <Copy aria-hidden /> Salin mutasi
              </Link>
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link href="/movements">
              <List aria-hidden /> Lihat di riwayat
            </Link>
          </Button>
        </div>
      </div>
      {query.isPending && <LoadingSkeleton />}
      {query.isError && <ErrorBanner onRetry={() => void query.refetch()} />}
      {query.data && <Body transfer={query.data} />}
    </div>
  );
}

function Body({ transfer }: { transfer: TransferDetailData }) {
  const [openMovement, setOpenMovement] = useState<string | null>(null);
  const by = transfer.createdBy;
  return (
    <article className="flex flex-col gap-6 rounded-xl border bg-card p-6">
      <header className="flex flex-col gap-3 border-b pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Mutasi stok {transfer.code}</h1>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700">
            Selesai
          </span>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            Tanggal:{" "}
            <b className="font-medium text-foreground">{formatDateTimeWib(transfer.createdAt)}</b>
          </span>
          <span>
            Dibuat oleh:{" "}
            <b className="font-medium text-foreground">
              {by ? `${by.name} (${movementRoleLabel(by.role)})` : "-"}
            </b>
          </span>
        </p>
      </header>

      <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
        <WarehouseCard label="Dari (gudang asal)" warehouse={transfer.fromWarehouse} />
        <div className="flex items-center justify-center">
          <span className="flex size-10 rotate-90 items-center justify-center rounded-full border bg-background text-primary md:rotate-0">
            <ArrowRight className="size-5" aria-hidden />
          </span>
        </div>
        <WarehouseCard label="Ke (gudang tujuan)" warehouse={transfer.toWarehouse} />
      </div>

      <section aria-labelledby="items-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="items-title" className="font-semibold">
            Daftar item mutasi
          </h2>
          <span className="text-xs text-muted-foreground">
            {formatNumber(transfer.items.length)} item
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">No</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Nama produk</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
                <TableHead>Satuan</TableHead>
                <TableHead>Pergerakan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfer.items.map((item, index) => (
                <TableRow key={item.productId}>
                  <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-right font-bold">
                    {formatNumber(item.quantity)}
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <MovementButton
                        label="Keluar"
                        id={item.outMovementId}
                        onOpen={setOpenMovement}
                      />
                      <MovementButton
                        label="Masuk"
                        id={item.inMovementId}
                        onOpen={setOpenMovement}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Catatan mutasi
        </h2>
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          {transfer.note ?? <span className="text-muted-foreground">Tidak ada catatan.</span>}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleCheck className="size-3.5 text-emerald-600" aria-hidden />
          Mutasi ini selesai secara instan dan riwayat tercatat permanen.
        </p>
      </section>

      <MovementDetailSheet id={openMovement} onClose={() => setOpenMovement(null)} />
    </article>
  );
}

function WarehouseCard({ label, warehouse }: { label: string; warehouse: TransferWarehouse }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold">
          {warehouse.code}
        </span>
      </div>
      <Link href={`/warehouses/${warehouse.id}`} className="font-bold hover:underline">
        {warehouse.name}
      </Link>
      <p className="text-sm text-muted-foreground">{warehouse.address ?? "-"}</p>
    </div>
  );
}

// P13 only answers for a warehouse the user may see, so the other side's button is left out.
function MovementButton({
  label,
  id,
  onOpen,
}: {
  label: string;
  id: string | null;
  onOpen: (id: string) => void;
}) {
  if (!id) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => onOpen(id)}>
      {label}
    </Button>
  );
}
