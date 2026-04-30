/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogStatus } from '../models/CatalogStatus';
import type { ScraperHealthReport } from '../models/ScraperHealthReport';
import type { SystemHealthReport } from '../models/SystemHealthReport';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class StatusService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Get catalog health and status
     * Returns catalog health information including total product count,
     * per-platform counts, last update times, and progress toward goals.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns CatalogStatus Catalog status
     * @throws ApiError
     */
    public getCatalogStatus(): CancelablePromise<CatalogStatus> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/status',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get scraper health status per platform
     * Returns health status for each platform's scraping pipeline.
     * Includes last run time, row counts, and error information.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns ScraperHealthReport Scraper health report
     * @throws ApiError
     */
    public getScraperHealth(): CancelablePromise<ScraperHealthReport> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/status/scrapers',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get system health — DB latency, pool, and scraper status
     * Returns system health information including database latency,
     * connection pool status, and scraper health for all platforms.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns SystemHealthReport System health report
     * @throws ApiError
     */
    public getSystemHealth(): CancelablePromise<SystemHealthReport> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/status/health',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
}
