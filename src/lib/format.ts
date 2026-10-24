// Display helpers (rule 13): dates are stored in UTC and shown in WIB; numbers use Indonesian format.
// Intl is built into Node and browsers, so no date library is needed.

const WIB_TIME_ZONE = "Asia/Jakarta";

const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

const dateFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: WIB_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: WIB_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${String(value)}`);
  }
  return date;
}

/** 24850 -> "24.850", 1234.5 -> "1.234,5" */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** 1500000 -> "Rp 1.500.000" with a non-breaking space so the prefix never wraps away from the digits. */
export function formatRupiah(value: number): string {
  return `Rp ${formatNumber(value)}`;
}

/** UTC instant -> "25 Okt 2024" (calendar day in WIB). */
export function formatDateWib(value: Date | string): string {
  return dateFormat.format(toDate(value));
}

/** UTC instant -> "25 Okt 2024, 03.05 WIB". */
export function formatDateTimeWib(value: Date | string): string {
  const date = toDate(value);
  return `${dateFormat.format(date)}, ${timeFormat.format(date)} WIB`;
}
