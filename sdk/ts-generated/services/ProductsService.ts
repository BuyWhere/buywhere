/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CompareDiffRequest } from '../models/CompareDiffRequest';
import type { CompareDiffResponse } from '../models/CompareDiffResponse';
import type { CompareMatrixRequest } from '../models/CompareMatrixRequest';
import type { CompareMatrixResponse } from '../models/CompareMatrixResponse';
import type { CompareResponse } from '../models/CompareResponse';
import type { ProductListResponse } from '../models/ProductListResponse';
import type { ProductResponse } from '../models/ProductResponse';
import type { ProductReviewsResponse } from '../models/ProductReviewsResponse';
import type { TrendingResponse } from '../models/TrendingResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductsService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Search products
     * Full-text search across product catalog with optional filters.
     * Uses PostgreSQL full-text search with English language ranking.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param q Full-text search query
     * @param category Filter by category name (case-insensitive partial match)
     * @param minPrice Minimum price filter
     * @param maxPrice Maximum price filter
     * @param source Filter by source platform
     * @param limit Number of results per page
     * @param offset Pagination offset
     * @returns ProductListResponse Product search results
     * @throws ApiError
     */
    public searchProductsLegacy(
        q?: string,
        category?: string,
        minPrice?: number,
        maxPrice?: number,
        source?: 'lazada_sg' | 'shopee_sg' | 'carousell' | 'qoo10',
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<ProductListResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products',
            query: {
                'q': q,
                'category': category,
                'min_price': minPrice,
                'max_price': maxPrice,
                'source': source,
                'limit': limit,
                'offset': offset,
            },
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Find cheapest product across all platforms
     * Returns the single lowest-priced listing for a product query.
     * Falls back to ILIKE search if full-text search returns no results.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param q Product name to search for
     * @param category Optional category filter
     * @returns ProductResponse Lowest priced product match
     * @throws ApiError
     */
    public bestPrice(
        q: string,
        category?: string,
    ): CancelablePromise<ProductResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/best-price',
            query: {
                'q': q,
                'category': category,
            },
            errors: {
                401: `Invalid or missing API key`,
                404: `No products found for query`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Compare same product across platforms
     * Find and compare the same product across different e-commerce platforms.
     * Uses fuzzy matching on product title and metadata to identify equivalent products.
     * Results cached for 5 minutes.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param productId Source product ID to find matches for
     * @param minPrice Minimum price filter for matches
     * @param maxPrice Maximum price filter for matches
     * @returns CompareResponse Product comparison results
     * @throws ApiError
     */
    public compareProduct(
        productId: number,
        minPrice?: number,
        maxPrice?: number,
    ): CancelablePromise<CompareResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/compare',
            query: {
                'product_id': productId,
                'min_price': minPrice,
                'max_price': maxPrice,
            },
            errors: {
                401: `Invalid or missing API key`,
                404: `Source product not found`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Compare multiple products across platforms
     * Compare up to 20 products across platforms in a single request.
     * Uses fuzzy matching on product title and metadata to identify equivalent products.
     * Results cached for 5 minutes.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param requestBody
     * @returns CompareMatrixResponse Matrix comparison results
     * @throws ApiError
     */
    public compareProductsMatrix(
        requestBody: CompareMatrixRequest,
    ): CancelablePromise<CompareMatrixResponse> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/v1/products/compare',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Compare 2-5 products directly — returns structured diff
     * Compare 2-5 products directly and return a structured field-level diff.
     * Shows which fields are identical vs different across products.
     * Includes price ranking (cheapest/most expensive).
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param requestBody
     * @returns CompareDiffResponse Structured product diff
     * @throws ApiError
     */
    public compareProductsDiff(
        requestBody: CompareDiffRequest,
    ): CancelablePromise<CompareDiffResponse> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/v1/products/compare/diff',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid request (must provide 2-5 product IDs)`,
                401: `Invalid or missing API key`,
                404: `One or more products not found`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get trending products by category
     * Returns recently updated products, useful for discovering trending items.
     * Sorted by most recently updated first.
     * Results cached for 5 minutes.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param category Filter by category name
     * @param limit Number of products to return
     * @returns TrendingResponse Trending products
     * @throws ApiError
     */
    public getTrendingProducts(
        category?: string,
        limit: number = 50,
    ): CancelablePromise<TrendingResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/trending',
            query: {
                'category': category,
                'limit': limit,
            },
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Export products as CSV or JSON
     * Bulk export products in CSV or JSON format.
     * Supports filtering by category, source, and price range.
     * Results are streamed for large exports.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param format Export format
     * @param category Filter by category
     * @param source Filter by source/platform
     * @param minPrice Minimum price filter
     * @param maxPrice Maximum price filter
     * @param limit Max records to export (up to 10000)
     * @param offset Pagination offset
     * @returns any Exported products
     * @throws ApiError
     */
    public exportProducts(
        format: 'csv' | 'json' = 'json',
        category?: string,
        source?: 'lazada_sg' | 'shopee_sg' | 'carousell' | 'qoo10',
        minPrice?: number,
        maxPrice?: number,
        limit: number = 1000,
        offset?: number,
    ): CancelablePromise<Array<Record<string, any>>> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/export',
            query: {
                'format': format,
                'category': category,
                'source': source,
                'min_price': minPrice,
                'max_price': maxPrice,
                'limit': limit,
                'offset': offset,
            },
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get product by ID
     * Retrieve a single product by its unique ID.
     * Only returns active products.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param productId Unique product ID
     * @returns ProductResponse Product details
     * @throws ApiError
     */
    public getProduct(
        productId: number,
    ): CancelablePromise<ProductResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/{product_id}',
            path: {
                'product_id': productId,
            },
            errors: {
                401: `Invalid or missing API key`,
                404: `Product not found`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get product reviews aggregation across platforms
     * Aggregate review data for a product across all platforms.
     * Returns aggregated avgRating, totalReviews, ratingDistribution (1-5 stars),
     * sentimentScore, and per-platform breakdown.
     * Uses canonical_id to find the same product on different platforms.
     * Results cached for 10 minutes.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param productId Unique product ID
     * @returns ProductReviewsResponse Product reviews aggregation
     * @throws ApiError
     */
    public getProductReviews(
        productId: number,
    ): CancelablePromise<ProductReviewsResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/products/{product_id}/reviews',
            path: {
                'product_id': productId,
            },
            errors: {
                401: `Invalid or missing API key`,
                404: `Product not found`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
}
