/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IngestionRunDetail } from '../models/IngestionRunDetail';
import type { IngestionRunSummary } from '../models/IngestionRunSummary';
import type { IngestRequest } from '../models/IngestRequest';
import type { IngestResponse } from '../models/IngestResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class IngestService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Ingest product batch
     * Batch ingest products from a scraping pipeline.
     * Supports upsert behavior (insert new products, update existing by sku+source).
     * Creates a PriceHistory record for each ingested product.
     * Maximum 1000 products per request.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param requestBody
     * @returns IngestResponse Ingestion completed
     * @throws ApiError
     */
    public ingestProducts(
        requestBody: IngestRequest,
    ): CancelablePromise<IngestResponse> {
        return this.httpRequest.request({
            method: 'POST',
            url: '/v1/ingest/products',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                401: `Invalid or missing API key`,
                422: `Validation error`,
                429: `Rate limit exceeded`,
                500: `Internal server error`,
            },
        });
    }
    /**
     * List recent ingestion runs
     * Returns paginated list of ingestion runs sorted by start time descending.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param limit Number of results per page
     * @param offset Pagination offset
     * @returns any List of ingestion runs
     * @throws ApiError
     */
    public listIngestionRuns(
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<{
        total?: number;
        limit?: number;
        offset?: number;
        items?: Array<IngestionRunSummary>;
    }> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/ingest/runs',
            query: {
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
     * Get ingestion run by ID
     * Retrieve details of a specific ingestion run.
     * Rate limit: 100 requests/minute per API key.
     *
     * @param runId Ingestion run ID
     * @returns IngestionRunDetail Ingestion run details
     * @throws ApiError
     */
    public getIngestionRun(
        runId: number,
    ): CancelablePromise<IngestionRunDetail> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/ingest/runs/{run_id}',
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
}
