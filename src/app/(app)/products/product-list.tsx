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
import { Pagination } from "@/components/pagination";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { formatNumber } from "@/lib/format";
import { ProductFormDialog } from "./product-form-dialog";
import { fetchProductsPage, PAGE_SIZE, PRODUCTS_QUERY_KEY, type Product } from "./product-api";

// P02 target: undefined = closed, null = create, a product = edit.
type FormTarget = Product | null | undefined;

// S07. Every role reads; the server refuses writes from non-Owners (403), the buttons are hidden
// for them only as a courtesy. Stock totals and filters arrive with the stock stories.
export function ProductList() {
  const [requestedPage, setPage] = useState(1);
  const [target, setTarget] = useState<FormTarget>(undefined);
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const list = useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, requestedPage],
    queryFn: () => fetchProductsPage(requestedPage),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const canManage = me.data?.user.role === "OWNER";

  const addButton = canManage && (
    <Button onClick={() => setTarget(null)}>
      <Plus aria-hidden />
      Tambah produk
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Produk</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Katalog SKU, satuan, dan batas stok minimum.
          </p>
        </div>
        {addButton}
      </div>

      {list.isPending && <LoadingSkeleton />}
      {list.isError && <ErrorBanner onRetry={() => void list.refetch()} />}
      {list.data && list.data.total === 0 && (
        <EmptyState
          message={canManage ? "Belum ada produk." : "Belum ada produk yang terdaftar."}
          action={addButton || undefined}
        />
      )}
      {list.data && list.data.total > 0 && (
        <>
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nama produk</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Batas minimum</TableHead>
                  {canManage && <TableHead className="w-32 text-right">Aksi</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono text-xs font-semibold">{product.sku}</TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.unit}</TableCell>
                    <TableCell className="text-right">{formatNumber(product.minStock)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Ubah ${product.name}`}
                          onClick={() => setTarget(product)}
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
            noun="produk"
            onPageChange={setPage}
          />
        </>
      )}

      {canManage && (
        <ProductFormDialog
          // `target ?? null` keeps the last edited product's values out of the create form.
          product={target ?? null}
          open={target !== undefined}
          onOpenChange={(open) => !open && setTarget(undefined)}
        />
      )}
    </div>
  );
}
