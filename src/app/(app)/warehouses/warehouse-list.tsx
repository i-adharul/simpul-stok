"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { Pagination } from "@/components/pagination";
import { pageCount } from "@/lib/pagination";
import { WarehouseArchiveDialog } from "./warehouse-archive-dialog";
import { WarehouseFormDialog } from "./warehouse-form-dialog";
import { fetchWarehouses, PAGE_SIZE, WAREHOUSES_QUERY_KEY, type Warehouse } from "./warehouse-api";

// P01 target: undefined = closed, null = create, a warehouse = edit.
type FormTarget = Warehouse | null | undefined;

// S05. The server decides what each role sees (assigned warehouses) and who may write (403);
// the buttons are hidden for roles that cannot use them only as a courtesy.
export function WarehouseList() {
  const [requestedPage, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  // An archive can empty the last page: clamp to the last page known from the previous response.
  const page = Math.min(requestedPage, lastPage);
  const [target, setTarget] = useState<FormTarget>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<Warehouse | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const list = useQuery({
    queryKey: [...WAREHOUSES_QUERY_KEY, page, showArchived],
    queryFn: () => fetchWarehouses(page, showArchived),
    placeholderData: keepPreviousData,
    retry: false,
  });
  if (list.data) {
    const last = pageCount(list.data.total, PAGE_SIZE);
    if (last !== lastPage) setLastPage(last);
  }
  const canManage = me.data?.user.role === "OWNER";

  const addButton = canManage && (
    <Button onClick={() => setTarget(null)}>
      <Plus aria-hidden />
      Tambah gudang
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gudang</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Kelola lokasi penyimpanan dan operasional cabang.
          </p>
        </div>
        {addButton}
      </div>
      {canManage && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              setShowArchived(event.target.checked);
              setPage(1);
            }}
          />
          Tampilkan yang diarsipkan
        </label>
      )}

      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && list.data.total === 0 && (
        <EmptyState
          message={
            canManage ? "Belum ada gudang." : "Belum ada gudang yang ditugaskan kepada Anda."
          }
          action={addButton || undefined}
        />
      )}
      {list.data && list.data.total > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Alamat</TableHead>
                  {canManage && <TableHead>Status</TableHead>}
                  {canManage && <TableHead className="w-48 text-right">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {warehouse.code}
                    </TableCell>
                    <TableCell className="font-medium">{warehouse.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {warehouse.address ?? "-"}
                    </TableCell>
                    {canManage && (
                      <TableCell>{warehouse.archivedAt ? "Diarsipkan" : "Aktif"}</TableCell>
                    )}
                    {canManage && (
                      <TableCell className="space-x-2 text-right whitespace-nowrap">
                        {!warehouse.archivedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Ubah ${warehouse.name}`}
                            onClick={() => setTarget(warehouse)}
                          >
                            <Pencil aria-hidden />
                            Ubah
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`${warehouse.archivedAt ? "Pulihkan" : "Arsipkan"} ${warehouse.name}`}
                          onClick={() => setArchiveTarget(warehouse)}
                        >
                          {warehouse.archivedAt ? (
                            <ArchiveRestore aria-hidden />
                          ) : (
                            <Archive aria-hidden />
                          )}
                          {warehouse.archivedAt ? "Pulihkan" : "Arsipkan"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={list.data.page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            noun="gudang"
            onPageChange={setPage}
          />
        </>
      )}

      {canManage && (
        <WarehouseArchiveDialog warehouse={archiveTarget} onClose={() => setArchiveTarget(null)} />
      )}
      {canManage && (
        <WarehouseFormDialog
          // `target ?? null` keeps the last edited warehouse's values out of the create form.
          warehouse={target ?? null}
          open={target !== undefined}
          onOpenChange={(open) => !open && setTarget(undefined)}
        />
      )}
    </div>
  );
}
