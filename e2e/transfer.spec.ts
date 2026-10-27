import { expect, test } from "@playwright/test";
import { loginAs, OWNER, searchStock, stockQuantity, stockRow } from "./helpers";

const FROM = "Gudang Surabaya";
const TO = "Gudang Cikarang";
const PRODUCT = "Garam Halus 250 g"; // stocked only in Surabaya; no other scenario touches it

// Scenario (c): create a transfer through S11 and P11, see S12 with a new MT code, and the quantities
// of both warehouses changed.
test("a transfer shows its detail page and moves stock between warehouses", async ({ page }) => {
  await loginAs(page, OWNER);
  await searchStock(page, PRODUCT);
  const fromRow = stockRow(page, FROM, PRODUCT);
  await expect(fromRow).toBeVisible();
  const fromBefore = await stockQuantity(fromRow);
  await expect(stockRow(page, TO, PRODUCT)).toHaveCount(0);

  await page.goto("/transfers/new");
  await page.getByLabel("Gudang asal").selectOption({ label: FROM });
  await page.getByLabel("Gudang tujuan").selectOption({ label: TO });
  await page.getByLabel("Cari produk").fill("Garam");
  await page.getByRole("button", { name: new RegExp(PRODUCT) }).click();
  await page.getByRole("textbox", { name: `Jumlah ${PRODUCT}` }).fill("5");
  await page.getByRole("button", { name: "Tinjau dan kirim" }).click();

  const review = page.getByRole("dialog", { name: "Tinjau mutasi" });
  await expect(review).toContainText(FROM);
  await expect(review).toContainText(TO);
  await review.getByRole("button", { name: "Kirim mutasi" }).click();

  await expect(page).toHaveURL(/\/transfers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Mutasi stok MT-/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: PRODUCT })).toBeVisible();

  await searchStock(page, PRODUCT);
  await expect.poll(() => stockQuantity(stockRow(page, FROM, PRODUCT))).toBe(fromBefore - 5);
  await expect.poll(() => stockQuantity(stockRow(page, TO, PRODUCT))).toBe(5);
});
