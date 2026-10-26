"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/states/error-banner";
import { fetchMe, ME_QUERY_KEY } from "@/components/app-shell/shell-user";
import {
  fetchWarehouseMembers,
  saveWarehouseMembers,
  warehouseMembersKey,
  WAREHOUSES_QUERY_KEY,
  type MemberCandidate,
  type Warehouse,
} from "./warehouse-api";

type Props = {
  /** The warehouse to assign users to; null keeps the dialog closed. */
  warehouse: Pick<Warehouse, "id" | "name"> | null;
  onClose: () => void;
};

const ROLE_LABEL: Record<MemberCandidate["role"], string> = {
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};

// P06. Only the Owner sees it (the server enforces it with 403 anyway). Saving replaces the whole set.
export function WarehouseMembersDialog({ warehouse, onClose }: Props) {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false });
  if (me.data?.user.role !== "OWNER") return null;
  // Remounted per warehouse, so the draft never leaks from one warehouse to the next.
  return (
    warehouse && <MembersDialogBody key={warehouse.id} warehouse={warehouse} onClose={onClose} />
  );
}

function MembersDialogBody({
  warehouse,
  onClose,
}: {
  warehouse: Pick<Warehouse, "id" | "name">;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const key = warehouseMembersKey(warehouse.id);
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchWarehouseMembers(warehouse.id),
    retry: false,
    // The checkboxes are an editable copy: do not refetch under the user's hands.
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  // null = untouched: show what the server says.
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const candidates = list.data?.candidates ?? [];
  const selected =
    draft ?? new Set(candidates.filter((user) => user.assigned).map((user) => user.id));
  const save = useMutation({
    mutationFn: () => saveWarehouseMembers(warehouse.id, [...selected]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      // The S06 assigned-users list lives under the warehouses key.
      await queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      onClose();
    },
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setDraft(next);
  }

  const term = search.trim().toLowerCase();
  const visible = candidates.filter(
    (user) => !term || `${user.name} ${user.email}`.toLowerCase().includes(term),
  );

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-130 -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-card p-6 shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-heading text-lg font-bold">
                Tugaskan pengguna
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Pilih pengguna yang memiliki akses operasional di {warehouse.name}.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Tutup"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari nama atau email..."
            aria-label="Cari pengguna"
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
          {list.isError && <ErrorBanner message="Daftar pengguna belum dapat dimuat." />}
          {save.isError && (
            <ErrorBanner message="Penugasan belum dapat disimpan. Silakan coba lagi." />
          )}
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
            {list.isPending && <li className="p-3 text-sm text-muted-foreground">Memuat...</li>}
            {list.isSuccess && visible.length === 0 && (
              <li className="p-3 text-sm text-muted-foreground">
                {candidates.length === 0
                  ? "Belum ada Admin Gudang atau Viewer."
                  : "Tidak ada pengguna yang cocok."}
              </li>
            )}
            {visible.map((user) => (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-muted/50">
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-4.5 shrink-0 accent-primary"
                      checked={selected.has(user.id)}
                      onChange={() => toggle(user.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 rounded-md border bg-muted px-2 py-0.5 text-xs">
                    {ROLE_LABEL[user.role]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <span className="text-sm font-medium text-muted-foreground">
              {selected.size} dipilih
            </span>
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Batal
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                disabled={!list.isSuccess || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Simpan
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
