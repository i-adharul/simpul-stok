import { expect, test } from "@playwright/test";
import { loginAs, OWNER, searchStock, stockQuantity, stockRow } from "./helpers";

const WAREHOUSE = "Gudang Pusat Jakarta";
const PRODUCT = "Kopi Sachet 3 in 1"; // no other scenario touches this pair

// Scenario (b): receive stock through P04, see the quantity grow on S09 and the movement on S10.
test("receiving stock raises the quantity and writes a movement", async ({ page }) => {
  await loginAs(page, OWNER);
  await searchStock(page, PRODUCT);
  const row = stockRow(page, WAREHOUSE, PRODUCT);
  await expect(row).toBeVisible();
  const before = await stockQuantity(row);

  await row.getByRole("button", { name: `Terima barang ${PRODUCT}` }).click();
  const dialog = page.getByRole("dialog", { name: "Terima barang" });
  await expect(dialog.getByLabel("Gudang")).toHaveValue(/.+/); // preselected from the row
  await dialog.getByLabel("Jumlah diterima").fill("25");
  await dialog.getByRole("button", { name: "Simpan penerimaan" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => stockQuantity(row)).toBe(before + 25);

  await page.goto("/movements");
  const movement = page
    .getByRole("row")
    .filter({ hasText: "Penerimaan" })
    .filter({ hasText: PRODUCT })
    .filter({ hasText: "+25" });
  await expect(movement).toHaveCount(1);
  await expect(movement).toContainText(WAREHOUSE);
});
