import { expect, test } from "@playwright/test";
import { DEMO_PRODUCTS } from "../prisma/demo-data";
import { loginAs, OWNER } from "./helpers";

// Scenario (a): log in as the Owner, see the dashboard figures, log out.
test("Owner logs in, sees the dashboard figures and logs out", async ({ page }) => {
  await loginAs(page, OWNER);

  await expect(page.getByRole("heading", { name: "Selamat datang, Owner Demo" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Ringkasan" });
  await expect(summary.getByRole("link", { name: /Total produk/ })).toContainText(
    String(DEMO_PRODUCTS.length),
  );
  // prisma/demo-data.ts leaves 8 LOW pairs and 2 OUT pairs (see demo-seed.test.ts for the rule).
  // The card text is "Stok menipis", the number, then the hint.
  await expect(summary.getByRole("link", { name: /Stok menipis/ })).toHaveText(
    /Stok menipis8.*2 produk habis/,
  );

  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/); // the session is gone
});
