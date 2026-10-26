import { apiFetch } from "@/lib/api-client";
import { clampPage } from "@/lib/pagination";
import type { ProductFormValues } from "./product-form-schema";

// Shape of the product API (docs/04_API_Spec.md). Declared here because the server type pulls in Prisma.
export type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  minStock: number;
  archivedAt: string | null;
};
export type ProductPage = { items: Product[]; total: number; page: number; pageSize: number };

export const PRODUCTS_QUERY_KEY = ["products"] as const;
export const PAGE_SIZE = 20;

export function fetchProducts(page: number): Promise<ProductPage> {
  return apiFetch<ProductPage>(`/api/products?page=${page}&pageSize=${PAGE_SIZE}`);
}

// Always sends all four fields: an edit never sends an empty body, which the API would refuse.
export function saveProduct(id: string | null, values: ProductFormValues): Promise<Product> {
  return apiFetch<Product>(id ? `/api/products/${id}` : "/api/products", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(values),
  });
}

// If the requested page is past the end (the last page emptied), load the last page instead; the
// response carries the page actually returned, which the list shows.
export async function fetchProductsPage(page: number): Promise<ProductPage> {
  const result = await fetchProducts(page);
  const last = clampPage(page, result.total, PAGE_SIZE);
  return last !== page ? fetchProducts(last) : result;
}
