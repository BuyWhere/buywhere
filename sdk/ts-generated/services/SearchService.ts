/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ProductListResponse } from '../models/ProductListResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SearchService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Full-text search across product catalog
     * Full-text search using PostgreSQL ts_rank with English language ranking.
     * Supports filtering by category, price range, platform, and availability.
     * Results cached for 10 minutes.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param q Full-text search query
     * @param category Filter by category (case-insensitive partial match)
     * @param minPrice Minimum price filter
     * @param maxPrice Maximum price filter
     * @param platform Filter by platform/source
     * @param inStock Filter by availability
     * @param limit Number of results per page
     * @param offset Pagination offset
     * @returns ProductListResponse Product search results
     * @throws ApiError
     */
    public searchProducts(
        q?: string,
        category?: string,
        minPrice?: number,
        maxPrice?: number,
        platform?: 'lazada_sg' | 'shopee_sg' | 'carousell' | 'qoo10',
        inStock?: boolean,
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<ProductListResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/search',
            query: {
                'q': q,
                'category': category,
                'min_price': minPrice,
                'max_price': maxPrice,
                'platform': platform,
                'in_stock': inStock,
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
}
