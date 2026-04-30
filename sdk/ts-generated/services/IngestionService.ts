/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IngestionRunComplete } from '../models/IngestionRunComplete';
import type { IngestionRunCreate } from '../models/IngestionRunCreate';
import type { IngestionRunResponse } from '../models/IngestionRunResponse';
import type { IngestionRunUpdate } from '../models/IngestionRunUpdate';
import type { IngestionStats } from '../models/IngestionStats';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class IngestionService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Register new ingestion run
     * Register a new ingestion run with the scraping pipeline.
     * Scraping pipelines should call this before starting to scrape,
     * then update progress periodically, and complete when done.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param requestBody
     * @returns IngestionRunResponse Ingestion run registered
     * @throws ApiError
     */
    public createIngestionRun(
        requestBody: IngestionRunCreate,
    ): CancelablePromise<IngestionRunResponse> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/v1/ingestion',
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
     * List recent ingestion runs
     * Returns paginated list of ingestion runs sorted by start time descending.
     * Optionally filter by source or status.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param source Filter by source platform
     * @param status Filter by status
     * @param limit Number of results per page
     * @param offset Pagination offset
     * @returns any List of ingestion runs
     * @throws ApiError
     */
    public listIngestionRunsPaginated(
        source?: string,
        status?: 'running' | 'completed' | 'failed' | 'cancelled',
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<{
        total?: number;
        limit?: number;
        offset?: number;
        items?: Array<IngestionRunResponse>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/ingestion',
            query: {
                'source': source,
                'status': status,
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
     * Get ingestion statistics
     * Aggregate statistics across all ingestion runs.
     * Includes total runs, completion rates, and row counts.
     * Cached for 60 seconds.
     * Rate limit: 100 requests/minute per API key.
     *
     * @returns IngestionStats Ingestion statistics
     * @throws ApiError
     */
    public getIngestionStats(): CancelablePromise<IngestionStats> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/ingestion/stats',
            errors: {
                401: `Invalid or missing API key`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Get ingestion run status
     * Retrieve details of a specific ingestion run.
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param runId Ingestion run ID
     * @returns IngestionRunResponse Ingestion run details
     * @throws ApiError
     */
    public getIngestionRunById(
        runId: number,
    ): CancelablePromise<IngestionRunResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/ingestion/{run_id}',
            path: {
                'run_id': runId,
            },
            errors: {
                401: `Invalid or missing API key`,
                404: `Ingestion run not found`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Update ingestion run progress
     * Update progress of a running ingestion run.
     * Only runs with status 'running' can be updated.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param runId Ingestion run ID
     * @param requestBody
     * @returns IngestionRunResponse Updated ingestion run
     * @throws ApiError
     */
    public updateIngestionRun(
        runId: number,
        requestBody: IngestionRunUpdate,
    ): CancelablePromise<IngestionRunResponse> {
        return this.httpRequest.request({
            method: 'PATCH',
            url: '/v1/ingestion/{run_id}',
            path: {
                'run_id': runId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Invalid or missing API key`,
                404: `Ingestion run not found`,
                409: `Run cannot be updated (not in running status)`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * Mark ingestion run as complete
     * Mark a running ingestion run as completed, failed, or cancelled.
     * This finalizes the run and clears related caches.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param runId Ingestion run ID
     * @param requestBody
     * @returns IngestionRunResponse Completed ingestion run
     * @throws ApiError
     */
    public completeIngestionRun(
        runId: number,
        requestBody: IngestionRunComplete,
    ): CancelablePromise<IngestionRunResponse> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/v1/ingestion/{run_id}/complete',
            path: {
                'run_id': runId,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Invalid or missing API key`,
                404: `Ingestion run not found`,
                409: `Run already finished`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
}
