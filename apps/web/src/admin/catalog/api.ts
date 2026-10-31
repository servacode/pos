import type {
  BarcodeLookupResponse,
  Category,
  CreateCategoryInput,
  CreateProductInput,
  ListResponse,
  ProductDetail,
  ProductListItem,
  ProductListQuery,
  TaxRate,
  Unit,
  UpdateCategoryInput,
  UpdateProductInput,
} from '@serva/core';
import { apiFetch } from '../../lib/api';

// The catalog's admin requests (17 › المنتجات; packages/core › contracts/catalog.ts). The server
// checks every permission again; the screens only hide what the user cannot do.

const id = (value: string) => encodeURIComponent(value);

/** `GET /v1/products?…`: only the filters that are set, in a stable order (the tests read the URL). */
export function productsPath(query: ProductListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.status) params.set('status', query.status);
  if (query.branchId) params.set('branchId', query.branchId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const search = params.toString();
  return search ? `/v1/products?${search}` : '/v1/products';
}

export function listProducts(query: ProductListQuery) {
  return apiFetch<ListResponse<ProductListItem>>(productsPath(query), { auth: true });
}

export function getProduct(productId: string) {
  return apiFetch<ProductDetail>(`/v1/products/${id(productId)}`, { auth: true });
}

export function createProduct(input: CreateProductInput) {
  return apiFetch<ProductDetail>('/v1/products', { method: 'POST', body: input, auth: true });
}

export function updateProduct(productId: string, input: UpdateProductInput) {
  return apiFetch<ProductDetail>(`/v1/products/${id(productId)}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** `POST /v1/products/{id}/archive` or `/restore`: no body, answers the product. */
export function setProductArchived(productId: string, archived: boolean) {
  return apiFetch<ProductDetail>(`/v1/products/${id(productId)}/${archived ? 'archive' : 'restore'}`, {
    method: 'POST',
    auth: true,
  });
}

export function lookupBarcode(code: string) {
  return apiFetch<BarcodeLookupResponse>(`/v1/barcodes/${id(code)}`, { auth: true });
}

export function listCategories() {
  return apiFetch<{ items: Category[] }>('/v1/categories', { auth: true });
}

export function createCategory(input: CreateCategoryInput) {
  return apiFetch<Category>('/v1/categories', { method: 'POST', body: input, auth: true });
}

export function updateCategory(categoryId: string, input: UpdateCategoryInput) {
  return apiFetch<Category>(`/v1/categories/${id(categoryId)}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function listUnits() {
  return apiFetch<{ items: Unit[] }>('/v1/units', { auth: true });
}

export function listTaxRates() {
  return apiFetch<{ items: TaxRate[] }>('/v1/tax-rates', { auth: true });
}
