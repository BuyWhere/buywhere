/**
 * Canonical API endpoint paths.
 *
 * Both the standalone /playground and the docs-playground import these
 * to prevent endpoint drift (see BUY-73845).
 */

export const SEARCH_ENDPOINT = '/v1/products/search';
export const PRODUCT_BY_ID_ENDPOINT = '/v1/products';
export const CATEGORIES_ENDPOINT = '/v1/categories';
export const DEALS_ENDPOINT = '/v1/deals';
