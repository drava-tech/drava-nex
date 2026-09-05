import { crumbRedirect } from "@/lib/crumb-redirect";

/**
 * The product-id crumb on /products/<id>/edit. There is no product detail
 * view — /edit is the only page under an id — so this goes up to the list
 * rather than sideways into the editor the crumb was clicked from.
 */
export async function GET() {
  return crumbRedirect("/products");
}
