/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogHealthReport } from '../models/CatalogHealthReport';
import type { CatalogStatsReport } from '../models/CatalogStatsReport';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class CatalogService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Get catalog health and quality report
     * Returns comprehensive catalog quality report including:
     * - Total indexed products by platform
     * - Schema compliance rates (missing title, price, url)
     * - Deduplication statistics
     * - Freshness/staleness metrics
     * Cached for 5 minutes.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns CatalogHealthReport Catalog health report
     * @throws ApiError
     */
    public getCatalogHealth(): CancelablePromise<CatalogHealthReport> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/catalog/health',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * List incomplete product records missing price/title/url
     * Returns products with incomplete records (missing title, price, or url).
     * Useful for identifying data quality issues.
     * Cached for 2 minutes.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param source Filter by source platform
     * @param limit Number of results per page
     * @param offset Pagination offset
     * @returns any Incomplete products list
     * @throws ApiError
     */
    public listIncompleteProducts(
        source?: string,
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<{
        total?: number;
        limit?: number;
        offset?: number;
        has_more?: boolean;
        items?: Array<{
            id?: number;
            sku?: string;
            source?: string;
            title?: string;
            price?: string | null;
            url?: string;
            is_active?: boolean;
            updated_at?: string;
            missing_fields?: Array<string>;
        }>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/catalog/incomplete',
            query: {
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
     * Get catalog statistics
     * Returns catalog statistics including total products by platform and category.
     * Cached for 5 minutes.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns CatalogStatsReport Catalog statistics
     * @throws ApiError
     */
    public getCatalogStats(): CancelablePromise<CatalogStatsReport> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/catalog/stats',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
}
