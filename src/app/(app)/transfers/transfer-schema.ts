import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/format";

// Client-side check for quick messages only; the server validates again (rule 4). The limits match
// src/modules/stock/stock-schema.ts (BL13).
export const MAX_TRANSFER_ITEMS = 50;
export const MAX_TRANSFER_QUANTITY = 1_000_000;
export const MAX_NOTE_LENGTH = 255;

// The quantity is text while typing: an empty or non-numeric value is an error, not a silent 0.
export type DraftRow = { productId: string; quantity: string };
export type Draft = {
  fromWarehouseId: string;
  toWarehouseId: string;
  rows: DraftRow[];
  note: string;
};

export type TransferPayload = {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: { productId: string; quantity: number }[];
  note?: string;
};

export type DraftErrors = {
  fromWarehouseId?: string;
  toWarehouseId?: string;
  items?: string;
  note?: string;
  /** Message per productId. */
  rows: Record<string, string>;
};

const QUANTITY_MESSAGE = `Jumlah harus bilangan bulat antara 1 dan ${formatNumber(MAX_TRANSFER_QUANTITY)}.`;

/** Returns the request body when the draft is valid, otherwise the messages to show. */
export function validateDraft(
  draft: Draft,
): { ok: true; payload: TransferPayload } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = { rows: {} };
  if (!draft.fromWarehouseId) errors.fromWarehouseId = "Pilih gudang asal.";
  if (!draft.toWarehouseId) errors.toWarehouseId = "Pilih gudang tujuan.";
  else if (draft.toWarehouseId === draft.fromWarehouseId) {
    errors.toWarehouseId = "Gudang tujuan harus berbeda dari gudang asal.";
  }
  if (draft.rows.length === 0) errors.items = "Tambahkan minimal satu produk.";
  else if (draft.rows.length > MAX_TRANSFER_ITEMS) {
    errors.items = `Maksimal ${MAX_TRANSFER_ITEMS} produk per mutasi.`;
  }
  const items: TransferPayload["items"] = [];
  for (const row of draft.rows) {
    const text = row.quantity.trim();
    const quantity = Number(text);
    if (!/^\d+$/.test(text) || quantity < 1 || quantity > MAX_TRANSFER_QUANTITY) {
      errors.rows[row.productId] = QUANTITY_MESSAGE;
    } else items.push({ productId: row.productId, quantity });
  }
  const note = draft.note.trim();
  if (note.length > MAX_NOTE_LENGTH) errors.note = `Catatan maksimal ${MAX_NOTE_LENGTH} karakter.`;

  if (Object.keys(errors).length > 1 || Object.keys(errors.rows).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    payload: {
      fromWarehouseId: draft.fromWarehouseId,
      toWarehouseId: draft.toWarehouseId,
      items,
      // An empty note is left out of the request.
      ...(note === "" ? {} : { note }),
    },
  };
}

export type TransferErrorView = {
  message: string;
  /** Set for INSUFFICIENT_STOCK: the row that should carry the message. */
  productId?: string;
  /** True when trying the same request again can succeed (too many concurrent transfers). */
  retry?: boolean;
};

/** Maps the API answer to Indonesian text. `productName` looks a productId up in the loaded rows. */
export function transferErrorMessage(
  error: unknown,
  productName: (productId: string) => string | undefined,
): TransferErrorView {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "INSUFFICIENT_STOCK") {
      const details = error.details as { productId?: unknown } | null | undefined;
      const productId = typeof details?.productId === "string" ? details.productId : undefined;
      const name = productId ? productName(productId) : undefined;
      return {
        productId,
        message: name
          ? `Stok ${name} di gudang asal tidak cukup.`
          : "Stok salah satu produk di gudang asal tidak cukup.",
      };
    }
    if (error.status === 409) {
      // The server text says whether a warehouse or product is archived, or that transfers collided.
      return { message: error.message, retry: error.message.startsWith("Terlalu banyak") };
    }
    if (error.status === 400) {
      return { message: "Data mutasi tidak valid. Periksa gudang, produk, dan jumlah." };
    }
    if (error.status === 403 || error.status === 404) {
      return {
        message:
          "Mutasi tidak dapat dilakukan. Gudang atau produk tidak ditemukan atau tidak boleh diakses.",
      };
    }
  }
  return { message: "Mutasi belum dapat dikirim. Silakan coba lagi.", retry: true };
}
