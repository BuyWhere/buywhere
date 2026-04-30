/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DealsResponse } from '../models/DealsResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class DealsService {
    constructor(public readonly httpRequest: BaseHttpRequest) {}
    /**
     * Find discounted products
     * Returns products currently priced below their original/historical price.
     * A product is identified as a deal when metadata contains `original_price`
     * and current price is lower by at least min_discount_pct%.
     * Sorted by discount depth (largest discount first).
     * Rate limit: 1000 requests/minute per API key.
     *
     * @param category Filter by product category
     * @param minDiscountPct Minimum discount percentage (0-100, default 10)
     * @param limit Max results (1-100, default 20)
     * @param offset Pagination offset
     * @returns DealsResponse Discounted products
     * @throws ApiError
     */
    public getDeals(
        category?: string,
        minDiscountPct: number = 10,
        limit: number = 20,
        offset?: number,
    ): CancelablePromise<DealsResponse> {
        return this.httpRequest.request({
            method: 'GET',
            url: '/v1/deals',
            query: {
                'category': category,
                'min_discount_pct': minDiscountPct,
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
