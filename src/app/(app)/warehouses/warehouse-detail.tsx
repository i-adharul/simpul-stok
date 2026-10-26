"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronRight, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { ApiError } from "@/lib/api-client";
import { ReceiveStockButton } from "../stock/stock-receive-dialog";
import { WarehouseArchiveDialog } from "./warehouse-archive-dialog";
import { WarehouseFormDialog } from "./warehouse-form-dialog";
import { WarehouseMembersDialog } from "./warehouse-members-dialog";
import {
  fetchWarehouse,
  warehouseKey,
  ROLE_LABEL,
  type WarehouseDetail as Detail,
} from "./warehouse-api";

// S06 (shell). Info and assigned users only; the stock and history sections arrive with E4-09.
export function WarehouseDetail({ id }: { id: string }) {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const query = useQuery({
    queryKey: warehouseKey(id),
    queryFn: () => fetchWarehouse(id),
    retry: false,
  });
  // 404 covers a missing ID and another organization's ID alike (rule 2).
  if (query.error instanceof ApiError && query.error.status === 404) notFound();
  const canManage = me.data?.user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        <Link href="/warehouses" className="hover:underline">
          Gudang
        </Link>
        <ChevronRight className="size-4" aria-hidden />
        <span className="text-foreground">{query.data?.name ?? "..."}</span>
      </nav>
      {query.isPending && <LoadingSkeleton />}
      {query.isError && <ErrorBanner onRetry={() => void query.refetch()} />}
      {query.data && <Body warehouse={query.data} canManage={canManage} />}
    </div>
  );
}

function Body({ warehouse, canManage }: { warehouse: Detail; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const archived = warehouse.archivedAt !== null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{warehouse.name}</h1>
          <span className="w-fit rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
            {warehouse.code}
          </span>
          <p className="text-sm text-muted-foreground">{warehouse.address ?? "-"}</p>
          <p className="text-sm">{archived ? "Diarsipkan" : "Aktif"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!archived && <ReceiveStockButton warehouseId={warehouse.id} />}
          {canManage && (
            <>
              {!archived && (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden />
                    Ubah
                  </Button>
                  <Button variant="outline" onClick={() => setAssigning(true)}>
                    <Users aria-hidden />
                    Tugaskan pengguna
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => setArchiving(true)}>
                {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {archived ? "Pulihkan" : "Arsipkan"}
              </Button>
            </>
          )}
        </div>
      </div>

      <section aria-labelledby="assigned-title" className="rounded-xl border bg-card p-4">
        <h2 id="assigned-title" className="font-semibold">
          Penanggung jawab ({warehouse.assignedUsers.length})
        </h2>
        {warehouse.assignedUsers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Belum ada pengguna yang ditugaskan.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {warehouse.assignedUsers.map((user) => (
              <li key={user.id} className="flex justify-between py-2 text-sm">
                <span className="font-medium">{user.name}</span>
                <span className="text-muted-foreground">{ROLE_LABEL[user.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Stok gudang akan tampil di sini.
      </section>
      <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Riwayat mutasi gudang akan tampil di sini.
      </section>

      {canManage && (
        <>
          <WarehouseFormDialog warehouse={warehouse} open={editing} onOpenChange={setEditing} />
          <WarehouseArchiveDialog
            warehouse={archiving ? warehouse : null}
            onClose={() => setArchiving(false)}
          />
          <WarehouseMembersDialog
            warehouse={assigning ? warehouse : null}
            onClose={() => setAssigning(false)}
          />
        </>
      )}
    </>
  );
}
