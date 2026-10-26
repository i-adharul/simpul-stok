import { ProductDetail } from "../product-detail";

// The id comes from the URL only to pick the product; the API checks the organization from the session.
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetail id={id} />;
}
