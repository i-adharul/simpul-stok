"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Boxes, Package, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorBanner } from "@/components/states/error-banner";
import { LoadingSkeleton } from "@/components/states/loading-skeleton";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import { formatDateTimeWib, formatNumber } from "@/lib/format";
import { AdjustStockButton } from "../stock/stock-adjust-dialog";
import { ReceiveStockButton } from "../stock/stock-receive-dialog";
import { activityText, activityTitle } from "./dashboard-activity";
import { DASHBOARD_QUERY_KEY, fetchDashboard, type Dashboard } from "./dashboard-api";

const STATUS_LABEL = { OUT: "Habis", LOW: "Menipis", OK: "Cukup" } as const;
const STATUS_CLASS = {
  OUT: "bg-destructive/10 text-destructive",
  LOW: "bg-amber-100 text-amber-800",
  OK: "bg-emerald-100 text-emerald-800",
} as const;

function SummaryCard({
  label,
  value,
  hint,
  href,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className="rounded-xl border bg-card p-4 hover:border-foreground/30">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        {label}
        {icon}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">{formatNumber(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

function SummaryCards({ summary }: { summary: Dashboard["summary"] }) {
  return (
    <section aria-label="Ringkasan" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Total produk"
        value={summary.totalProducts}
        hint="Produk aktif"
        href="/products"
        icon={<Package className="size-4" aria-hidden />}
      />
      <SummaryCard
        label="Total unit stok"
        value={summary.totalUnits}
        hint="Di gudang yang bisa kamu akses"
        href="/stock"
        icon={<Boxes className="size-4" aria-hidden />}
      />
      <SummaryCard
        label="Stok menipis"
        value={summary.lowCount}
        hint={`${formatNumber(summary.outCount)} produk habis`}
        href="/stock"
        icon={<TriangleAlert className="size-4" aria-hidden />}
      />
      <SummaryCard
        label="Mutasi hari ini"
        value={summary.movementsToday}
        hint="Semua jenis pergerakan stok"
        href="/movements"
        icon={<ArrowLeftRight className="size-4" aria-hidden />}
      />
    </section>
  );
}

function RestockCard({ restock }: { restock: Dashboard["restock"] }) {
  return (
    <section className="rounded-xl border bg-card lg:col-span-7">
      <div className="border-b p-4">
        <h2 className="font-semibold">Perlu diisi ulang</h2>
        <p className="text-sm text-muted-foreground">Produk di bawah batas stok minimum</p>
      </div>
      {restock.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Semua stok masih di atas batas minimum.</p>
      ) : (
        <ul className="divide-y">
          {restock.items.map((item) => (
            <li
              key={`${item.warehouse.id}:${item.product.id}`}
              className="flex items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <Link href={`/products/${item.product.id}`} className="font-medium hover:underline">
                  {item.product.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {item.product.sku} ·{" "}
                  <Link href={`/warehouses/${item.warehouse.id}`} className="hover:underline">
                    {item.warehouse.name}
                  </Link>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                <span className="whitespace-nowrap font-medium">
                  {formatNumber(item.quantity)} / {formatNumber(item.product.minStock)}{" "}
                  {item.product.unit}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status]}`}
                >
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between border-t p-3 text-sm">
        <span className="text-muted-foreground">
          Menampilkan {formatNumber(restock.items.length)} dari {formatNumber(restock.total)}
        </span>
        <Link href="/stock" className="font-medium text-primary hover:underline">
          Lihat semua stok
        </Link>
      </div>
    </section>
  );
}

function ActivityCard({ items }: { items: Dashboard["recentActivity"] }) {
  return (
    <section className="rounded-xl border bg-card lg:col-span-5">
      <div className="border-b p-4">
        <h2 className="font-semibold">Aktivitas terbaru</h2>
        <p className="text-sm text-muted-foreground">Pergerakan stok terkini</p>
      </div>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Belum ada aktivitas stok.</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="p-4 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{activityTitle(item.type)}</span>
                <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                  {formatDateTimeWib(item.createdAt)}
                </time>
              </div>
              <p className="text-muted-foreground">{activityText(item)}</p>
              {item.createdBy && (
                <p className="text-xs text-muted-foreground">Oleh: {item.createdBy.name}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t p-3 text-center">
        {/* S18 is only for the Owner and is added in E13-02; until then every role goes to S10. */}
        <Link
          href="/movements"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Lihat log aktivitas lengkap
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function isEmpty(data: Dashboard): boolean {
  return (
    data.summary.totalProducts === 0 &&
    data.summary.totalUnits === 0 &&
    data.recentActivity.length === 0
  );
}

// S04. Every figure comes from GET /api/dashboard, which already narrows stock to the user's warehouses.
export function DashboardView() {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  const query = useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboard, retry: false });
  const name = me.data?.user.name;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {name ? `Selamat datang, ${name}` : "Dashboard"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <AdjustStockButton />
          <ReceiveStockButton />
        </div>
      </div>
      {query.isPending && <LoadingSkeleton />}
      {query.isError && <ErrorBanner onRetry={() => void query.refetch()} />}
      {query.data && isEmpty(query.data) && (
        <EmptyState
          message="Belum ada data stok."
          action={
            <Link href="/products" className={buttonVariants({ variant: "outline" })}>
              Lihat produk
            </Link>
          }
        />
      )}
      {query.data && !isEmpty(query.data) && (
        <>
          <SummaryCards summary={query.data.summary} />
          <div className="grid items-start gap-6 lg:grid-cols-12">
            <RestockCard restock={query.data.restock} />
            <ActivityCard items={query.data.recentActivity} />
          </div>
        </>
      )}
    </div>
  );
}
