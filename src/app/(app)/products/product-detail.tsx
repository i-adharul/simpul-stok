"use client";

import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { ApiError } from "@/lib/api-client";
import { formatDateWib, formatNumber } from "@/lib/format";
import { ProductArchiveDialog } from "./product-archive-dialog";
import { ProductFormDialog } from "./product-form-dialog";
import { fetchProduct, productKey, type Product } from "./product-api";

// S08 (shell). Basic info only; the stock and history sections arrive with E4-09.
export function ProductDetail({ id }: { id: string }) {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const query = useQuery({
    queryKey: productKey(id),
    queryFn: () => fetchProduct(id),
    retry: false,
  });
  // 404 covers a missing ID and another organization's ID alike (rule 2). Same pattern as S06.
  if (query.error instanceof ApiError && query.error.status === 404) notFound();
  const canManage = me.data?.user.role === "OWNER";

  return (
    <div className="flex flex-col gap-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-sm text-muted-foreground"
      >
        <Link href="/products" className="hover:underline">
          Produk
        </Link>
        <ChevronRight className="size-4" aria-hidden />
        <span className="text-foreground">{query.data?.name ?? "..."}</span>
      </nav>
      {query.isPending && <LoadingSkeleton />}
      {query.isError && <ErrorBanner onRetry={() => void query.refetch()} />}
      {query.data && <Body product={query.data} canManage={canManage} />}
    </div>
  );
}

function Body({ product, canManage }: { product: Product; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const archived = product.archivedAt !== null;
  const info: [string, string][] = [
    ["Satuan", product.unit],
    ["Stok minimum", formatNumber(product.minStock)],
    ["Dibuat", formatDateWib(product.createdAt)],
    ["Status", archived ? "Diarsipkan" : "Aktif"],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          <span className="w-fit rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
            {product.sku}
          </span>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {!archived && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Ubah
              </Button>
            )}
            <Button variant="outline" onClick={() => setArchiving(true)}>
              {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {archived ? "Pulihkan" : "Arsipkan"}
            </Button>
          </div>
        )}
      </div>

      <dl className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
        {info.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Stok produk per gudang akan tampil di sini.
      </section>
      <section className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Riwayat mutasi produk akan tampil di sini.
      </section>

      {canManage && (
        <>
          <ProductFormDialog product={product} open={editing} onOpenChange={setEditing} />
          <ProductArchiveDialog
            product={archiving ? product : null}
            onClose={() => setArchiving(false)}
          />
        </>
      )}
    </>
  );
}
