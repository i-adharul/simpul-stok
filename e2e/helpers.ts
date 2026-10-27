import { expect, type Locator, type Page } from "@playwright/test";

// The LOCAL demo accounts (src/modules/platform/seed.ts). The e2e run only ever targets simpul_test.
export const OWNER = { email: "owner@demotoko.test", password: "owner-demo-2026" } as const;

export async function loginAs(page: Page, account: { email: string; password: string }) {
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

// A click before React has hydrated the form submits it natively (page reload, empty fields). The
// show-password toggle only changes its label once the page is interactive, so it doubles as a ready
// signal without a fixed sleep.
async function waitForHydration(page: Page) {
  const toggle = page.getByRole("button", { name: /(Tampilkan|Sembunyikan) password/ });
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAccessibleName("Sembunyikan password", { timeout: 1000 });
  }).toPass();
}

// "1.250 bks" -> 1250 (Indonesian grouping uses a dot).
export function quantityOf(cellText: string | null): number {
  const digits = (cellText ?? "").replace(/\s*[a-z]+$/i, "").replace(/\./g, "");
  return Number(digits);
}

// The table row of the stock list for one warehouse and one product (S09). The row is found by its
// own cells, so the filter chips and other rows never match.
export function stockRow(page: Page, warehouse: string, product: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: warehouse, exact: true }) })
    .filter({ has: page.getByRole("link", { name: product, exact: true }) });
}

// Third cell of the S09 table is "Stok" (Gudang, Produk, SKU, Stok, ...); index 3.
export async function stockQuantity(row: Locator): Promise<number> {
  return quantityOf(await row.getByRole("cell").nth(3).textContent());
}

export async function searchStock(page: Page, term: string) {
  await page.goto("/stock");
  await page.getByLabel("Cari produk").fill(term);
}
