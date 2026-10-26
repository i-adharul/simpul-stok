"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
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
import { Pagination } from "./pagination";
import { WarehouseFormDialog } from "./warehouse-form-dialog";
import { fetchWarehouses, PAGE_SIZE, WAREHOUSES_QUERY_KEY, type Warehouse } from "./warehouse-api";

// P01 target: undefined = closed, null = create, a warehouse = edit.
type FormTarget = Warehouse | null | undefined;

// S05. The server decides what each role sees (assigned warehouses) and who may write (403);
// the buttons are hidden for roles that cannot use them only as a courtesy.
export function WarehouseList() {
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<FormTarget>(undefined);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const list = useQuery({
    queryKey: [...WAREHOUSES_QUERY_KEY, page],
    queryFn: () => fetchWarehouses(page),
    placeholderData: keepPreviousData,
    retry: false,
  });
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

      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState
          message={
            canManage ? "Belum ada gudang." : "Belum ada gudang yang ditugaskan kepada Anda."
          }
          action={addButton || undefined}
        />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kode</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Alamat</TableHead>
                  {canManage && <TableHead className="w-24 text-right">Aksi</TableHead>}
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
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Ubah ${warehouse.name}`}
                          onClick={() => setTarget(warehouse)}
                        >
                          <Pencil aria-hidden />
                          Ubah
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
            onPageChange={setPage}
          />
        </>
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
