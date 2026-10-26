// Numbered pagination (functional spec, Design decisions: Pagination). Pure so it is easy to test.
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Page numbers to show: first, last and one neighbour each side of the current page; null is a gap. */
export function pageWindow(current: number, last: number): (number | null)[] {
  const wanted = new Set([1, last, current - 1, current, current + 1]);
  const pages = [...wanted].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1]! > 1) {
      // A gap of exactly one page is shown as that page, not as "...".
      if (page - pages[index - 1]! === 2) result.push(page - 1);
      else result.push(null);
    }
    result.push(page);
  });
  return result;
}

/** Keeps a requested page inside 1..last (an archive or delete can empty the last page). */
export function clampPage(requested: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, requested), pageCount(total, pageSize));
}
